import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttendanceBadge, attendanceSummary, effectiveReminder, eventAttendance, eventDisplayTitle, proposalFields, visibleEvents } from '../app/calendar/attendance.tsx';
import { EventForm } from '../app/calendar/calendar-client.tsx';
import type { CalendarEvent, EventFields, Proposal } from '../app/calendar/types.ts';

const fields: EventFields = { title: 'Dinner with Alex', date: '2026-09-18', time: '19:00', kind: 'food', location: 'Example restaurant', detail: 'Fictional test fixture' };
const confirmed: CalendarEvent = { ...fields, id: 'confirmed', date: fields.date!, source: 'Manual', revision: 1 };
const invited: CalendarEvent = { ...confirmed, id: 'invited', attendance: 'invited' };

test('legacy events stay confirmed while invitations have an explicit accessible text status', () => {
  assert.equal(eventAttendance(confirmed), 'confirmed');
  assert.equal(eventAttendance(invited), 'invited');
  const invitationMarkup = renderToStaticMarkup(createElement(AttendanceBadge, { event: invited }));
  const confirmedMarkup = renderToStaticMarkup(createElement(AttendanceBadge, { event: confirmed }));
  assert.match(invitationMarkup, />Invited<\/span>/);
  assert.match(confirmedMarkup, />Confirmed<\/span>/);
  assert.equal(invitationMarkup.replace('Invited', ''), confirmedMarkup.replace('Confirmed', ''), 'Both statuses use the same visual treatment');
});

test('invitation prefix is only presentation, disappears when going, and cannot accumulate', () => {
  assert.equal(eventDisplayTitle(invited), 'INVITATION: Dinner with Alex');
  assert.equal(eventDisplayTitle({ ...invited, attendance: 'confirmed' }), 'Dinner with Alex');
  assert.equal(invited.title, 'Dinner with Alex');
  assert.equal(eventDisplayTitle({ ...invited, title: 'INVITATION: INVITATION: Dinner with Alex' }), 'INVITATION: Dinner with Alex');
  assert.equal(eventDisplayTitle({ ...confirmed, title: ' invitation : Dinner with Alex' }), 'Dinner with Alex');
  assert.equal(eventDisplayTitle(confirmed), confirmed.title);
});

test('invitation visibility is a local filter that retains every legacy confirmed event', () => {
  const events = [invited, confirmed];
  assert.deepEqual(visibleEvents(events, true), events);
  assert.deepEqual(visibleEvents(events, false), [confirmed]);
  assert.equal(events.length, 2);
  assert.equal(attendanceSummary(events), '1 confirmed, 1 invited');
  assert.equal(attendanceSummary([]), 'No plans');
});

test('completing missing details retains invited or uncertain attendance instead of forcing confirmation', () => {
  const proposal: Proposal = { id: 'proposal', revision: 1, action: 'create', event: { ...fields, date: undefined }, attendance: 'invited', reason: 'The date is missing', evidence: [], unresolvedFields: ['date'] };
  assert.equal(proposalFields(proposal).attendance, 'invited');
  assert.equal(proposalFields({ ...proposal, attendance: 'unknown' }).attendance, 'invited');
  assert.equal(proposalFields({ ...proposal, attendance: 'confirmed' }).attendance, 'confirmed');
  assert.equal(proposalFields({ ...proposal, attendance: 'confirmed', event: { ...proposal.event, attendance: 'invited' } }).attendance, 'invited');
  assert.equal(proposal.event.attendance, undefined, 'Preparing a form must not mutate saved evidence');
});

test('cancellation notices never acquire an invitation label from uncertain attendance', () => {
  const cancellation: Proposal = { id: 'cancellation', revision: 1, action: 'cancel', event: { ...fields, title: 'Fictional cancellation' }, attendance: 'unknown', reason: 'No matching saved plan', evidence: [], unresolvedFields: ['targetEventId'] };
  assert.equal(eventDisplayTitle(proposalFields(cancellation)), 'Fictional cancellation');
  assert.equal(eventDisplayTitle(proposalFields({ ...cancellation, attendance: 'invited', event: { ...cancellation.event, attendance: 'invited' } })), 'Fictional cancellation');
});

test('an uncertain amendment inherits its saved target attendance in presentation and editing', () => {
  const change: Proposal = { id: 'change', revision: 1, action: 'update', targetEventId: confirmed.id, targetRevision: confirmed.revision, event: { ...fields, attendance: 'invited' }, attendance: 'unknown', reason: 'The new time is unclear', evidence: [], unresolvedFields: ['time'] };
  assert.equal(proposalFields(change, confirmed).attendance, 'confirmed');
  assert.equal(eventDisplayTitle(proposalFields(change, confirmed)), fields.title);
  assert.equal(proposalFields(change, invited).attendance, 'invited');
  assert.equal(proposalFields({ ...change, attendance: 'invited' }, confirmed).attendance, 'invited', 'An explicit invitation is still shown honestly');
});

test('invitations are quiet without erasing the reminder preference used when going', () => {
  assert.equal(effectiveReminder(invited), null);
  assert.equal(effectiveReminder(confirmed), 15);
  assert.equal(effectiveReminder({ ...confirmed, time: undefined }), null);
  assert.equal(effectiveReminder({ ...confirmed, reminderMinutes: null }), null);
  assert.equal(effectiveReminder({ ...confirmed, reminderMinutes: 0 }), 0);
  const preference = { ...invited, reminderMinutes: 30 };
  assert.equal(effectiveReminder(preference), null);
  assert.equal(preference.reminderMinutes, 30);
  assert.equal(effectiveReminder({ ...preference, attendance: 'confirmed' }), 30);
});

test('the invitation edit form shows its canonical title, selected attendance and disabled reminder', () => {
  const markup = renderToStaticMarkup(createElement(EventForm, { initial: invited, busy: false, label: 'Save changes', onSave: async () => {} }));
  const title = markup.match(/<input\b[^>]*id="[^"]*-title"[^>]*>/)?.[0];
  const radio = markup.match(/<input\b[^>]*value="invited"[^>]*>/)?.[0];
  const reminder = markup.match(/<select\b[^>]*id="[^"]*-reminder"[^>]*>/)?.[0];
  assert.ok(title); assert.match(title, /value="Dinner with Alex"/); assert.doesNotMatch(title, /INVITATION:/);
  assert.ok(radio); assert.match(radio, /checked=""/);
  assert.ok(reminder); assert.match(reminder, /disabled=""/);
  assert.match(markup, /<option value="off" selected="">None<\/option>/);
  assert.match(markup, /No RSVP is sent/);
});

test('legacy confirmed edit forms keep their reminder and default to going', () => {
  const markup = renderToStaticMarkup(createElement(EventForm, { initial: confirmed, busy: false, label: 'Save changes', onSave: async () => {} }));
  const radio = markup.match(/<input\b[^>]*value="confirmed"[^>]*>/)?.[0];
  const reminder = markup.match(/<select\b[^>]*id="[^"]*-reminder"[^>]*>/)?.[0];
  assert.ok(radio); assert.match(radio, /checked=""/);
  assert.ok(reminder); assert.doesNotMatch(reminder, /disabled/);
  assert.match(markup, /<option value="15" selected="">15 minutes before<\/option>/);
});
