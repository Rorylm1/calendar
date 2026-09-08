import type { CalendarEvent, EventFields } from '../calendar/types';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const demoDate = (date: string) => new Date(`${date}T12:00:00Z`);
export const isoDate = (date: Date) => date.toISOString().slice(0, 10);
export const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) => demoDate(date).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
export function monthCells(year: number, month: number) { const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; const count = Math.ceil((offset + new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) / 7) * 7; return Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, month, i + 1 - offset, 12))); }
export function eventsOnDate(events: CalendarEvent[], date: string) { return events.filter(event => event.date === date || (event.kind === 'stay' && event.endDate && date > event.date && date <= event.endDate)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99')); }
export function timeOnDay(event: CalendarEvent, date: string) {
  if (event.kind === 'stay' && event.endDate && date > event.date && date < event.endDate) return 'Staying';
  if (event.kind === 'stay') return event.endDate === date ? `Checkout${event.endTime ? ` · ${event.endTime}` : ' · time not supplied'}` : `Check-in${event.time ? ` · ${event.time}` : ' · time not supplied'}`;
  return `${event.time || 'Time not supplied'}${event.time && event.timeZone ? ` · ${event.timeZone}` : ''}`;
}
export function eventWhen(event: EventFields) { return `${event.date ? dateLabel(event.date) : 'Date to confirm'}${event.endDate && event.endDate !== event.date ? ` – ${dateLabel(event.endDate)}` : ''} · ${event.time || 'Time not supplied'}`; }
