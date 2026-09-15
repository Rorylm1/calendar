import { Temporal } from '@js-temporal/polyfill';

export function supportedTimeZone(value: string): boolean {
  try { Temporal.Instant.from('2026-01-01T00:00:00Z').toZonedDateTimeISO(value); return true; } catch { return false; }
}

function resolveZone(value: string, context: string): string | undefined {
  if (supportedTimeZone(value)) return value;
  // Abbreviations are not globally unique. Resolve only with source evidence;
  // never accept Intl's unrelated legacy alias interpretation of BST or IST.
  if (value.toUpperCase() === 'BST' && /\b(?:London|United Kingdom|British Summer Time|UK)\b/i.test(context) && !/\b(?:Bangladesh|Bougainville)\b/i.test(context)) return 'Europe/London';
  if (value.toUpperCase() === 'IST') {
    if (/\b(?:India Standard Time|Indian Standard Time|Asia\/Kolkata|Asia\/Calcutta)\b/i.test(context)) return 'Asia/Kolkata';
    const pair = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+IST\s*\(\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:GMT|UTC)\s*\)/i.exec(context);
    if (pair) {
      const minutes = (hour: string, minute: string | undefined, period: string) => (Number(hour) % 12 + (period.toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(minute || 0);
      if (Number(pair[1]) >= 1 && Number(pair[1]) <= 12 && Number(pair[4]) >= 1 && Number(pair[4]) <= 12 && Number(pair[2] || 0) < 60 && Number(pair[5] || 0) < 60 && (minutes(pair[1]!, pair[2], pair[3]!) - minutes(pair[4]!, pair[5], pair[6]!) + 1440) % 1440 === 330) return '+05:30';
    }
  }
  return undefined;
}

export function normalizeSourceTimeZones<T extends { timeZone?: string; endTimeZone?: string }>(input: T, context: string) {
  const event = { ...input }; const unresolved: string[] = [];
  for (const key of ['timeZone', 'endTimeZone'] as const) {
    if (!event[key]) continue;
    const zone = resolveZone(event[key]!, context);
    if (zone) event[key] = zone;
    else { delete event[key]; unresolved.push(key === 'timeZone' ? 'ambiguousTimeZone' : 'ambiguousEndTimeZone'); }
  }
  return { event, unresolved };
}
