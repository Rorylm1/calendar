import { z } from 'zod';
import { AppError } from './errors.ts';
import { Temporal } from '@js-temporal/polyfill';

export const DateValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date');
export const TimeValue = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const ZoneValue = z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Unknown time zone');
export const Kind = z.enum(['food', 'travel', 'stay', 'social', 'appointment', 'other']);
// Undefined uses the timed-event default. Null explicitly disables reminders.
export const ReminderMinutes = z.number().int().min(0).max(10080).nullable();
export const EventFields = z.object({
  title: z.string().trim().min(1).max(240), date: DateValue.optional(), time: TimeValue.optional(),
  endDate: DateValue.optional(), endTime: TimeValue.optional(), timeZone: ZoneValue.optional(), endTimeZone: ZoneValue.optional(),
  kind: Kind.default('other'), location: z.string().max(1000).default(''), detail: z.string().max(6000).default(''), reference: z.string().max(240).optional(), reminderMinutes: ReminderMinutes.optional(),
}).strict();
export const EventPatch = z.object({
  title: z.string().trim().min(1).max(240).optional(), date: DateValue.optional(), time: TimeValue.nullable().optional(),
  endDate: DateValue.nullable().optional(), endTime: TimeValue.nullable().optional(), timeZone: ZoneValue.nullable().optional(), endTimeZone: ZoneValue.nullable().optional(),
  kind: Kind.optional(), location: z.string().max(1000).optional(), detail: z.string().max(6000).optional(), reference: z.string().max(240).nullable().optional(), reminderMinutes: ReminderMinutes.optional(),
}).strict();
export type Fields = z.infer<typeof EventFields>;
export type CalendarEvent = Fields & { id: string; date: string; source: 'Gmail' | 'Manual'; revision: number };
export type Proposal = {
  id: string; action: 'create' | 'update' | 'cancel'; targetEventId?: string; targetRevision?: number;
  event: Fields; attendance: 'confirmed' | 'invited' | 'unknown' | 'declined'; reason: string; evidence: string[];
  unresolvedFields: string[]; status: 'pending' | 'confirmed' | 'dismissed'; revision: number; sourceMessageIds: string[]; createdAt: string;
};
export type SourceMessage = {
  id: string; threadId: string; from: string; to: string; subject: string; receivedAt: string; sentByOwner: boolean;
  text: string; context: { id: string; from: string; sentByOwner: boolean; sentAt: string; text: string }[];
  calendar?: { fields: Fields; uid?: string; method?: string }; unsupportedAttachments: string[];
};
export type GmailConnection = {
  ownerId: string; email: string; status: 'connected' | 'reconnect_required'; lastSyncAt: string | null; nextSyncAt: string;
  historyId?: string; error: string | null; warning: string | null;
};
export function mergeFields(base: Fields, patch: z.infer<typeof EventPatch>): Fields {
  const next = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) if (value === null && key !== 'reminderMinutes') delete next[key]; else if (value !== undefined) next[key] = value;
  return EventFields.parse(next);
}
export function confirmedFields(value: Fields): Fields & { date: string } {
  const fields = EventFields.extend({ date: DateValue }).parse(value);
  const instant = (date: string, time: string, timeZone: string) => {
    try { return Temporal.ZonedDateTime.from(`${date}T${time}[${timeZone}]`, { disambiguation: 'reject' }).epochNanoseconds; }
    catch { throw new AppError('invalid_event', 'This local time is ambiguous or does not exist because the clocks change. Clarify the time or use UTC.'); }
  };
  const start = fields.time && fields.timeZone ? instant(fields.date, fields.time, fields.timeZone) : undefined;
  const endZone = fields.endTimeZone || fields.timeZone;
  const end = fields.endTime && endZone ? instant(fields.endDate || fields.date, fields.endTime, endZone) : undefined;
  if (start !== undefined && end !== undefined) { if (end < start) throw new AppError('invalid_event', 'The end time is before the start time in the supplied time zones.'); }
  else {
    if (fields.endDate && fields.endDate < fields.date) throw new AppError('invalid_event', 'The end date is before the start date. Supply both time zones if this journey crosses the date line.');
    if (fields.time && fields.endTime && (!fields.endDate || fields.endDate === fields.date) && fields.endTime < fields.time) throw new AppError('invalid_event', 'An overnight event needs its arrival date, or both time zones for a journey.');
  }
  return fields;
}
