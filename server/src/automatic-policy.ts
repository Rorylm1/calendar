import type { Fields } from './domain.ts';

// Gemini resolves geography in new extractions. These narrow fallbacks repair
// older proposals whose city was known but whose optional zone was flagged.
function cityZone(location: string): string | undefined {
  if (/\b(?:NYC|New York)\b/i.test(location) && !/\bLondon\b/i.test(location)) return 'America/New_York';
  if (/\bLondon\b/i.test(location) && !/\b(?:Ontario|Canada|NYC|New York)\b/i.test(location)) return 'Europe/London';
}

export function resolveOptionalDetails(input: Fields, flags: string[], context: string) {
  const event = { ...input }; const unresolved: string[] = [];
  const city = event.kind !== 'travel' ? cityZone(event.location) : undefined;
  const zone = city && cityZone(context) === city ? city : undefined;
  const dropStart = () => { delete event.time; delete event.timeZone; delete event.endTime; delete event.endTimeZone; };
  for (const field of flags) {
    switch (field.replace(/[ _-]/g, '').toLowerCase()) {
      case 'attendance': case 'rsvp': case 'confirmation': break;
      case 'time': case 'starttime': dropStart(); break;
      case 'endtime': delete event.endTime; delete event.endTimeZone; break;
      case 'enddate': delete event.endDate; delete event.endTime; delete event.endTimeZone; break;
      case 'timezone': case 'ambiguoustimezone':
        if (zone) event.timeZone = zone;
        else dropStart();
        break;
      case 'endtimezone': case 'ambiguousendtimezone':
        if (zone) event.endTimeZone = zone;
        else { delete event.endTime; delete event.endTimeZone; }
        break;
      case 'location': case 'exactlocationvenue':
        // Retain a source-supported city/neighbourhood even if the exact venue
        // is not announced. Other uncertain locations are omitted.
        if (!zone) event.location = '';
        else if (!context.toLowerCase().includes(event.location.toLowerCase())) event.location = zone === 'Europe/London' ? 'London' : 'New York';
        break;
      case 'description': case 'detail': event.detail = ''; break;
      case 'reference': delete event.reference; break;
      default: unresolved.push(field);
    }
  }
  // A date-only entry must not retain a lone clock end or an implied duration.
  if (!event.time) { delete event.endTime; delete event.endTimeZone; delete event.timeZone; }
  return { event, unresolved };
}
