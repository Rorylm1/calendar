import type { Attendance, CalendarEvent, EventFields, Proposal } from './types';

// Events saved before attendance was introduced were confirmed plans.
export const eventAttendance = (event: Pick<EventFields, 'attendance'>): Attendance =>
  event.attendance === 'invited' ? 'invited' : 'confirmed';

export function eventDisplayTitle(event: Pick<EventFields, 'attendance' | 'title'>): string {
  const title = event.title.replace(/^\s*(?:invitation\s*:\s*)+/i, '') || 'Untitled plan';
  return eventAttendance(event) === 'invited'
    ? `INVITATION: ${title}`
    : title;
}

export const visibleEvents = (events: CalendarEvent[], showInvitations: boolean) =>
  showInvitations ? events : events.filter(event => eventAttendance(event) === 'confirmed');

export function attendanceSummary(events: CalendarEvent[]) {
  const invited = events.filter(event => eventAttendance(event) === 'invited').length;
  const confirmed = events.length - invited;
  return [confirmed ? `${confirmed} confirmed` : '', invited ? `${invited} invited` : '']
    .filter(Boolean).join(', ') || 'No plans';
}

export function proposalFields(proposal: Proposal, target?: CalendarEvent): EventFields {
  // A cancellation is a notice, not a new invitation. Uncertain amendments
  // retain the saved plan's status until the owner chooses otherwise.
  const attendance = proposal.action === 'cancel' ? 'confirmed'
    : proposal.action === 'update' && proposal.attendance === 'unknown' && target
      ? eventAttendance(target)
      : proposal.event.attendance ?? (proposal.attendance === 'confirmed' ? 'confirmed' : 'invited');
  return {
    ...proposal.event,
    attendance,
  };
}

export function effectiveReminder(event: EventFields): number | null {
  if (!event.time || eventAttendance(event) === 'invited') return null;
  return event.reminderMinutes === undefined ? 15 : event.reminderMinutes;
}

export function AttendanceBadge({ event }: { event: Pick<EventFields, 'attendance'> }) {
  const attendance = eventAttendance(event);
  return <span className="attendance-badge">
    {attendance === 'invited' ? 'Invited' : 'Confirmed'}
  </span>;
}
