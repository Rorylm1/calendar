import { randomBytes } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hash, safeEqual } from './crypto.ts';
import { EventFields, type CalendarEvent } from './domain.ts';
import { AppError } from './errors.ts';
import { Store, type EventExportMetadata } from './store.ts';

type FeedConfig = { CALENDAR_PUBLIC_ORIGIN?: string; CALENDAR_SERVICE_TOKEN: string };
type FeedGrant = { token: string; tokenHash: string; updatedAt: string };
export type FeedIssue = { id: string; reason: string };
const grantBucket = 'calendar_feed_grant';
const emptyBody = z.object({}).strict();
const defaultTimeZone = 'Europe/London';

function publicOrigin(config: FeedConfig): string | null {
  try {
    const url = new URL(config.CALENDAR_PUBLIC_ORIGIN || '');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}

// RFC 5545 §§3.1 and 3.3.11: escape property values before folding UTF-8
// content lines. Never split a code point, and count continuation whitespace.
export function escapeCalendarText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
export function foldCalendarLine(value: string): string {
  const lines: string[] = []; let line = ''; let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 75) { lines.push(line); line = ' '; bytes = 1; }
    line += character; bytes += size;
  }
  lines.push(line); return lines.join('\r\n');
}
const dateValue = (value: string) => value.replaceAll('-', '');
const instantValue = (value: Temporal.Instant) => value.toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');
function localInstant(date: string, time: string, timeZone: string): Temporal.Instant {
  try { return Temporal.ZonedDateTime.from(`${date}T${time}[${timeZone}]`, { disambiguation: 'reject' }).toInstant(); }
  catch { throw new AppError('feed_event_time', 'This time is ambiguous or does not exist because the clocks change. Choose an explicit, unambiguous time zone or UTC.'); }
}

function eventLines(event: CalendarEvent, metadata: EventExportMetadata): string[] {
  const { id, source: _source, revision, ...input } = event;
  const fields = EventFields.required({ date: true }).parse(input);
  const invited = fields.attendance === 'invited';
  // Attendance is presentation metadata; remove an old presentation prefix
  // before adding it, so acceptance and legacy prefixed titles stay readable.
  const title = fields.title.replace(/^\s*(?:invitation\s*:\s*)+/i, '') || 'Untitled plan';
  if (!Number.isSafeInteger(revision) || revision < 1) throw new AppError('feed_event_revision', 'This event needs a valid revision before it can be exported.');
  const lines = ['BEGIN:VEVENT', `UID:${hash(id)}@personal-calendar`, `SEQUENCE:${revision - 1}`,
    `DTSTAMP:${instantValue(Temporal.Instant.from(metadata.modifiedAt))}`, `LAST-MODIFIED:${instantValue(Temporal.Instant.from(metadata.modifiedAt))}`,
    `CREATED:${instantValue(Temporal.Instant.from(metadata.createdAt))}`, `SUMMARY:${escapeCalendarText(`${invited ? 'INVITATION: ' : ''}${title}`)}`, 'CLASS:PRIVATE',
    `STATUS:${invited ? 'TENTATIVE' : 'CONFIRMED'}`, `TRANSP:${invited ? 'TRANSPARENT' : 'OPAQUE'}`];
  let detail = fields.detail; const alarms: string[] = [];
  if (!fields.time) {
    const start = Temporal.PlainDate.from(fields.date);
    const finalDate = Temporal.PlainDate.from(fields.endDate || fields.date);
    if (Temporal.PlainDate.compare(finalDate, start) < 0) throw new AppError('feed_event_time', 'The end date is before the start date.');
    // A hotel's stored end date is checkout. Other date-only end dates are
    // inclusive in the calendar UI; RFC 5545 DTEND is always exclusive.
    const end = fields.kind === 'stay' && fields.endDate && Temporal.PlainDate.compare(finalDate, start) > 0 ? finalDate : finalDate.add({ days: 1 });
    lines.push(`DTSTART;VALUE=DATE:${dateValue(start.toString())}`, `DTEND;VALUE=DATE:${dateValue(end.toString())}`);
    if (fields.endTime) detail = [detail, `End time: ${fields.endTime}${fields.endTimeZone ? ` (${fields.endTimeZone})` : ''}. Start time has not been provided.`].filter(Boolean).join('\n');
  } else {
    const start = localInstant(fields.date, fields.time, fields.timeZone || defaultTimeZone);
    lines.push(`DTSTART:${instantValue(start)}`);
    if (fields.endTime) {
      const end = localInstant(fields.endDate || fields.date, fields.endTime, fields.endTimeZone || fields.timeZone || defaultTimeZone);
      if (Temporal.Instant.compare(end, start) < 0) throw new AppError('feed_event_time', 'The end time is before the start time. Add the arrival date and check both time zones.');
      // Equal start/end represents an instant; omission has that meaning in
      // RFC 5545, whereas a non-increasing explicit DTEND is invalid.
      if (Temporal.Instant.compare(end, start) > 0) lines.push(`DTEND:${instantValue(end)}`);
    } else if (fields.endDate && fields.endDate !== fields.date) {
      if (fields.endDate < fields.date) throw new AppError('feed_event_time', 'The end date is before the start date.');
      detail = [detail, `End date: ${fields.endDate}. End time has not been provided.`].filter(Boolean).join('\n');
    }
    const reminder = fields.reminderMinutes === undefined ? 15 : fields.reminderMinutes;
    // Invitations never export alarms, even with a saved reminder preference.
    // The preference takes effect if this same event is later confirmed.
    if (!invited && reminder !== null) alarms.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeCalendarText(title)}`, `TRIGGER:${reminder === 0 ? 'PT0M' : `-PT${reminder}M`}`, 'END:VALARM');
  }
  if (fields.location) lines.push(`LOCATION:${escapeCalendarText(fields.location)}`);
  if (detail) lines.push(`DESCRIPTION:${escapeCalendarText(detail)}`);
  lines.push(...alarms, 'END:VEVENT'); return lines;
}

function issueFor(event: CalendarEvent, error: unknown): FeedIssue {
  return { id: event.id, reason: error instanceof AppError ? error.message : 'This event has incomplete or invalid calendar fields. Open it and check its date and time.' };
}
export function renderCalendarFeed(store: Store): { body: string; blockedEvents: FeedIssue[] } {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Personal Calendar//Private Calendar Feed//EN', 'CALSCALE:GREGORIAN'];
  const blockedEvents: FeedIssue[] = [];
  // Only saved events are read. Pending proposals, evidence, source messages,
  // booking references and account identifiers never enter the feed.
  for (const event of store.events()) {
    const metadata = store.eventExportMetadata(event);
    try { lines.push(...eventLines(event, metadata)); }
    catch (error) { blockedEvents.push(issueFor(event, error)); }
  }
  lines.push('END:VCALENDAR');
  return { body: `${lines.map(foldCalendarLine).join('\r\n')}\r\n`, blockedEvents };
}

export function calendarFeedSettings(config: FeedConfig, store: Store) {
  const origin = publicOrigin(config); const grant = store.get<FeedGrant>(grantBucket);
  const url = origin && grant ? `${origin}/calendar/feed/${grant.token}.ics` : null;
  const blockedEvents: FeedIssue[] = [];
  // Validation must not create metadata merely because the settings were read.
  const validationTime = { revision: 1, createdAt: '2000-01-01T00:00:00Z', modifiedAt: '2000-01-01T00:00:00Z' };
  for (const event of store.events()) { try { eventLines(event, validationTime); } catch (error) { blockedEvents.push(issueFor(event, error)); } }
  return { configured: Boolean(origin), enabled: Boolean(origin && grant), url, webcalUrl: url?.replace(/^https?:/, 'webcal:') || null, updatedAt: grant?.updatedAt || null, blockedEvents };
}

export function registerFeedRoutes(app: FastifyInstance, config: FeedConfig, store: Store) {
  app.register(async feed => {
    feed.addHook('onRequest', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store'); reply.header('Referrer-Policy', 'no-referrer'); reply.header('X-Content-Type-Options', 'nosniff');
    });
    const ownerOnly = async (request: FastifyRequest) => {
      const token = request.headers.authorization;
      if (!token?.startsWith('Bearer ') || !safeEqual(token.slice(7), config.CALENDAR_SERVICE_TOKEN)) throw new AppError('unauthorized', 'Calendar access is required.', 401);
    };
    const requireOrigin = () => { if (!publicOrigin(config)) throw new AppError('feed_not_configured', 'Calendar subscriptions are not configured yet.', 503); };
    const newGrant = () => { const token = randomBytes(32).toString('base64url'); store.put(grantBucket, 'default', { token, tokenHash: hash(token), updatedAt: new Date().toISOString() } satisfies FeedGrant); };
    feed.get('/v1/calendar/feed', { preHandler: ownerOnly }, async () => calendarFeedSettings(config, store));
    feed.post('/v1/calendar/feed/enable', { preHandler: ownerOnly }, async request => {
      emptyBody.parse(request.body || {}); requireOrigin();
      store.transaction(() => { if (!store.get<FeedGrant>(grantBucket)) newGrant(); });
      return calendarFeedSettings(config, store);
    });
    feed.post('/v1/calendar/feed/rotate', { preHandler: ownerOnly }, async request => {
      emptyBody.parse(request.body || {}); requireOrigin();
      store.transaction(() => { if (!store.get<FeedGrant>(grantBucket)) throw new AppError('feed_disabled', 'Enable the calendar subscription before replacing its link.', 409); newGrant(); });
      return calendarFeedSettings(config, store);
    });
    feed.delete('/v1/calendar/feed', { preHandler: ownerOnly }, async request => {
      emptyBody.parse(request.body || {}); store.remove(grantBucket); return calendarFeedSettings(config, store);
    });
    feed.get<{ Params: { token: string } }>('/calendar/feed/:token.ics', async (request, reply) => {
      const token = request.params.token; const grant = store.get<FeedGrant>(grantBucket);
      if (!publicOrigin(config) || !/^[A-Za-z0-9_-]{43}$/.test(token) || !safeEqual(hash(token), grant?.tokenHash || hash('disabled-feed'))) return reply.status(404).type('text/plain; charset=utf-8').send('Calendar feed not found.');
      const result = renderCalendarFeed(store);
      reply.header('Content-Disposition', 'inline; filename="personal-calendar.ics"');
      reply.header('X-Calendar-Omitted-Events', result.blockedEvents.length);
      return reply.type('text/calendar; charset=utf-8').send(result.body);
    });
  });
}
