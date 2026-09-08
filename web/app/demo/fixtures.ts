import type { CalendarEvent, Proposal } from '../calendar/types';

export const DEMO_DATE = '2026-09-11';
export type SampleId = 'dinner' | 'birthday' | 'missing-date' | 'offer';
export type DemoProposal = Proposal & { sampleId: SampleId; source: string };
export type DemoSample = { id: SampleId; label: string; hint: string; source: string; sender: string; body: string; explanation: string; proposal?: DemoProposal };

export const INITIAL_EVENTS: readonly CalendarEvent[] = [
  { id: 'seed-dinner', title: 'Dinner at Luca', date: '2026-09-08', time: '19:30', kind: 'food', location: 'Clerkenwell, London', detail: 'A fictional table for two. End time not supplied.', source: 'Sample email', revision: 1 },
  { id: 'seed-train', title: 'Train to Edinburgh', date: '2026-09-11', time: '17:30', endTime: '21:52', timeZone: 'Europe/London', kind: 'travel', location: 'King’s Cross → Edinburgh Waverley', detail: 'Coach C · seat 21. Fictional journey times.', source: 'Sample email', revision: 1 },
  { id: 'seed-hotel', title: 'The Rowan', date: '2026-09-11', endDate: '2026-09-13', kind: 'stay', location: 'Edinburgh', detail: 'A fictional two-night stay. Check-in and checkout times were not supplied.', source: 'Sample email', revision: 1 },
  { id: 'seed-coffee', title: 'Coffee with Maya', date: '2026-09-16', time: '10:00', kind: 'social', location: 'Clerkenwell, London', detail: 'A catch-up over coffee. End time not supplied.', source: 'Sample forward', revision: 1 },
  { id: 'seed-flight', title: 'Flight to Copenhagen', date: '2026-09-22', time: '09:20', endTime: '12:15', timeZone: 'Europe/London', endTimeZone: 'Europe/Copenhagen', kind: 'travel', location: 'London Heathrow → Copenhagen', detail: 'A fictional itinerary. Each time is local to its airport.', source: 'Sample email', revision: 1 },
  { id: 'seed-concert', title: 'Live at the Roundhouse', date: '2026-09-26', time: '19:00', kind: 'social', location: 'Camden, London', detail: 'Two fictional tickets. Doors at 19:00; show end time not supplied.', source: 'Sample email', revision: 1 },
];

const suggestion = (sampleId: SampleId, event: Proposal['event'], patch: Partial<DemoProposal> = {}): DemoProposal => ({ id: `suggestion-${sampleId}`, sampleId, source: 'Sample email', action: 'create', event, attendance: 'confirmed', reason: 'The sample confirms a personal booking.', evidence: [], unresolvedFields: [], revision: 1, ...patch });
export const SAMPLES: readonly DemoSample[] = [
  {
    id: 'dinner', label: 'A dinner booking', hint: 'A booking, ready to review', source: 'Sample email', sender: 'Juniper Reservations',
    body: 'Your table for four at Juniper is confirmed for Thursday 17 September 2026 at 19:30.\n\nYou’ll find us in Islington, London. We look forward to welcoming you.',
    explanation: 'A confirmed booking has a place, a date and a time. You still choose what goes on the calendar.',
    proposal: suggestion('dinner', { title: 'Dinner at Juniper', date: '2026-09-17', time: '19:30', kind: 'food', location: 'Islington, London', detail: 'Table for four. End time not supplied.' }),
  },
  {
    id: 'birthday', label: 'A birthday invitation', hint: 'You decide if you’re going', source: 'Sample forward', sender: 'Alex',
    body: 'Birthday drinks at mine on Saturday 19 September 2026, from eight in the evening. Would love you to come!\n\nAlex’s place, London.',
    explanation: 'An invitation is a possibility. It becomes a plan when you decide to go.',
    proposal: suggestion('birthday', { title: 'Alex’s birthday', date: '2026-09-19', time: '20:00', kind: 'social', location: 'Alex’s place, London', detail: 'Birthday drinks. End time not supplied.' }, { source: 'Sample forward', attendance: 'invited', reason: 'The sample is an invitation. Attendance has not been confirmed.' }),
  },
  {
    id: 'missing-date', label: 'A little missing context', hint: '“Tomorrow” needs a date', source: 'Sample forward', sender: 'Sam',
    body: 'See you tomorrow at eight in the evening at Riverside!',
    explanation: 'The original message date wasn’t included in this forward. Choose the date before making it a plan.',
    proposal: suggestion('missing-date', { title: 'Dinner with Sam', time: '20:00', kind: 'social', location: 'Riverside', detail: 'The original message date was not supplied.' }, { source: 'Sample forward', attendance: 'unknown', reason: '“Tomorrow” needs the original message date or your clarification.', unresolvedFields: ['date'] }),
  },
  {
    id: 'offer', label: 'A travel offer', hint: 'Some messages can stay out', source: 'Sample email', sender: 'The Weekend Edit',
    body: 'Fancy a September escape?\n\nFlights to Lisbon from £39. Book by 15 September 2026 to see our latest offers.',
    explanation: 'This is a promotion. There’s no personal booking or agreed plan, so it doesn’t add anything to review.',
  },
];
