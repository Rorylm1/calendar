import type { CalendarEvent, EventFields } from '../calendar/types';
import { INITIAL_EVENTS, SAMPLES, type DemoProposal, type SampleId } from './fixtures';

export type DemoState = { events: CalendarEvent[]; proposals: DemoProposal[]; handled: Partial<Record<SampleId, 'pending' | 'added' | 'dismissed' | 'filtered' | 'removed'>>; notice: string; error: string };
export type DemoAction =
  | { type: 'capture'; sampleId: SampleId }
  | { type: 'complete'; proposalId: string; fields: EventFields }
  | { type: 'dismiss'; proposalId: string }
  | { type: 'edit'; eventId: string; fields: EventFields }
  | { type: 'attendance'; eventId: string; attendance: 'confirmed' | 'invited' }
  | { type: 'remove'; eventId: string }
  | { type: 'clear-notice' }
  | { type: 'clear-error' }
  | { type: 'reset' };
export function demoTitle(event: Pick<EventFields, 'title' | 'attendance'>): string {
  const title = event.title.replace(/^\s*(?:invitation\s*:\s*)+/i, '').trim() || 'Untitled plan';
  return event.attendance === 'invited' ? `INVITATION: ${title}` : title;
}
export function initialDemoState(): DemoState { return { events: INITIAL_EVENTS.map(event => ({ ...event })), proposals: [], handled: {}, notice: '', error: '' }; }
export function validDemoDate(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(date.slice(0, 4)) >= 1000 && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date; }
function localInstant(date: string, time: string, timeZone: string): number | undefined {
  try {
    const desired = Date.parse(`${date}T${time}:00Z`); const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const local = (value: number) => { const parts = Object.fromEntries(formatter.formatToParts(value).map(part => [part.type, part.value])); return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`); };
    let guess = desired;
    for (let attempt = 0; attempt < 4; attempt++) { const offset = desired - local(guess); if (offset === 0) return [guess - 3_600_000, guess + 3_600_000].some(other => local(other) === desired) ? undefined : guess; guess += offset; }
  } catch { /* An invalid or ambiguous local time must stay unconfirmed. */ }
  return undefined;
}
export function validateDemoFields(fields: EventFields): string | null {
  if (!fields.title.trim() || fields.title.length > 200) return 'Give this plan a title, up to 200 characters.';
  if (!fields.date || !validDemoDate(fields.date)) return 'Choose a real date for this plan.';
  if ([fields.time, fields.endTime].some(time => time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return 'Check the time for this plan.';
  if (fields.kind === 'stay' && (!fields.endDate || !validDemoDate(fields.endDate))) return 'Choose a valid checkout date for this sample stay.';
  if (fields.endDate && (!validDemoDate(fields.endDate) || fields.endDate < fields.date)) return 'The end date must be on or after the start date.';
  if (fields.kind === 'stay' && fields.endDate && fields.endDate <= fields.date) return 'Checkout must be after check-in.';
  if (fields.time) {
    const start = localInstant(fields.date, fields.time, fields.timeZone || 'Europe/London');
    const end = fields.endTime ? localInstant(fields.endDate || fields.date, fields.endTime, fields.endTimeZone || fields.timeZone || 'Europe/London') : undefined;
    if (start === undefined || (fields.endTime && end === undefined)) return 'This local time is unclear around a clock change. Choose an unambiguous time for the sample.';
    if (end !== undefined && end <= start) return 'Arrival or end time must be after the start, in the supplied time zones.';
  }
  if (fields.location.length > 500 || fields.detail.length > 2000) return 'Keep the place under 500 characters and notes under 2,000.';
  return null;
}
function cleanFields(fields: EventFields): EventFields { return { ...fields, title: demoTitle({ ...fields, attendance: 'confirmed' }), location: fields.location.trim(), detail: fields.detail.trim(), time: fields.time || undefined, endDate: fields.endDate || undefined, endTime: fields.endTime || undefined }; }
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === 'reset') return { ...initialDemoState(), notice: 'Back to a fresh September.' };
  if (action.type === 'clear-notice') return { ...state, notice: '' };
  if (action.type === 'clear-error') return { ...state, error: '' };
  if (action.type === 'capture') {
    if (state.handled[action.sampleId]) return state;
    const sample = SAMPLES.find(item => item.id === action.sampleId); if (!sample) return state;
    if (!sample.proposal) return { ...state, handled: { ...state.handled, [sample.id]: 'filtered' }, notice: 'This offer stays out of your calendar.', error: '' };
    const proposal: DemoProposal = { ...sample.proposal, event: { ...sample.proposal.event }, evidence: [sample.body], unresolvedFields: [...sample.proposal.unresolvedFields] };
    const fields = { ...proposal.event, attendance: proposal.attendance === 'confirmed' ? 'confirmed' as const : 'invited' as const };
    if (!proposal.unresolvedFields.length && !validateDemoFields(fields)) {
      const event: CalendarEvent = { ...cleanFields(fields), date: fields.date!, id: `demo-${sample.id}`, source: proposal.source, revision: 1 };
      return { ...state, events: [...state.events, event], handled: { ...state.handled, [sample.id]: 'added' }, notice: `${demoTitle(event)} was added automatically.`, error: '' };
    }
    return { ...state, proposals: [...state.proposals, proposal], handled: { ...state.handled, [sample.id]: 'pending' }, notice: 'A missing detail needs your help.', error: '' };
  }
  if (action.type === 'complete') {
    const proposal = state.proposals.find(item => item.id === action.proposalId); if (!proposal) return state;
    const error = validateDemoFields(action.fields); if (error) return { ...state, error };
    const event: CalendarEvent = { ...cleanFields(action.fields), attendance: action.fields.attendance ?? (proposal.attendance === 'confirmed' ? 'confirmed' : 'invited'), date: action.fields.date!, id: `demo-${proposal.sampleId}`, source: proposal.source, revision: 1 };
    return { ...state, events: [...state.events, event], proposals: state.proposals.filter(item => item.id !== proposal.id), handled: { ...state.handled, [proposal.sampleId]: 'added' }, notice: `${demoTitle(event)} is on your sample calendar.`, error: '' };
  }
  if (action.type === 'dismiss') {
    const proposal = state.proposals.find(item => item.id === action.proposalId); if (!proposal) return state;
    return { ...state, proposals: state.proposals.filter(item => item.id !== proposal.id), handled: { ...state.handled, [proposal.sampleId]: 'dismissed' }, notice: 'Item dismissed.', error: '' };
  }
  if (action.type === 'edit') {
    const event = state.events.find(item => item.id === action.eventId); if (!event) return state;
    const error = validateDemoFields(action.fields); if (error) return { ...state, error };
    return { ...state, events: state.events.map(item => item.id === event.id ? { ...cleanFields(action.fields), attendance: action.fields.attendance ?? event.attendance, date: action.fields.date!, id: event.id, source: event.source, revision: event.revision + 1 } : item), notice: 'Your sample plan has been updated.', error: '' };
  }
  if (action.type === 'attendance') {
    const event = state.events.find(item => item.id === action.eventId);
    if (!event || (event.attendance ?? 'confirmed') === action.attendance) return state;
    return { ...state, events: state.events.map(item => item.id === event.id ? { ...item, attendance: action.attendance, revision: item.revision + 1 } : item), notice: 'Attendance updated. No RSVP is sent.', error: '' };
  }
  if (action.type === 'remove') {
    const event = state.events.find(item => item.id === action.eventId); if (!event) return state;
    const sample = SAMPLES.find(item => `demo-${item.id}` === event.id);
    return { ...state, events: state.events.filter(item => item.id !== event.id), handled: sample ? { ...state.handled, [sample.id]: 'removed' } : state.handled, notice: 'Removed from the sample calendar.', error: '' };
  }
  return state;
}
