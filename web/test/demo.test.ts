import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DemoMonth from '../app/demo/demo-month.tsx';
import DemoForm from '../app/demo/demo-form.tsx';
import { demoReducer, demoTitle, initialDemoState, validDemoDate, validateDemoFields } from '../app/demo/state.ts';
import { INITIAL_EVENTS, SAMPLES } from '../app/demo/fixtures.ts';
import { eventsOnDate, monthCells, timeOnDay } from '../app/demo/dates.ts';

test('a dated dinner is added automatically once and remains editable', () => {
  const initial = initialDemoState(); let state = demoReducer(initial, { type: 'capture', sampleId: 'dinner' });
  assert.equal(state.events.length, 7); assert.equal(state.proposals.length, 0); assert.equal(state.handled.dinner, 'added');
  const event = state.events.at(-1)!; assert.equal(event.attendance, 'confirmed'); assert.equal(event.date, '2026-09-17'); assert.equal(event.source, 'Sample email');
  state = demoReducer(state, { type: 'edit', eventId: event.id, fields: { ...event, title: 'Dinner with friends', date: '2026-09-18' } });
  assert.equal(state.events.at(-1)!.id, event.id); assert.equal(state.events.at(-1)!.title, 'Dinner with friends'); assert.equal(state.events.at(-1)!.revision, 2);
  assert.equal(demoReducer(state, { type: 'capture', sampleId: 'dinner' }), state); assert.equal(initial.events.length, 6);
});
test('a birthday is added as an invitation and attendance is reversible without changing identity', () => {
  let state = demoReducer(initialDemoState(), { type: 'capture', sampleId: 'birthday' }); const event = state.events.at(-1)!;
  assert.equal(state.proposals.length, 0); assert.equal(event.attendance, 'invited'); assert.equal(event.date, '2026-09-19'); assert.equal(demoTitle(event), 'INVITATION: Alex’s birthday'); assert.equal(event.title, 'Alex’s birthday');
  state = demoReducer(state, { type: 'attendance', eventId: event.id, attendance: 'confirmed' });
  assert.equal(demoTitle(state.events.at(-1)!), 'Alex’s birthday'); assert.equal(state.events.at(-1)!.revision, 2);
  state = demoReducer(state, { type: 'attendance', eventId: event.id, attendance: 'invited' });
  assert.equal(state.events.at(-1)!.id, event.id); assert.equal(state.events.at(-1)!.revision, 3); assert.equal(demoTitle(state.events.at(-1)!), 'INVITATION: Alex’s birthday');
  assert.equal(demoReducer(state, { type: 'capture', sampleId: 'birthday' }), state);
  assert.equal(demoReducer(state, { type: 'attendance', eventId: event.id, attendance: 'invited' }), state);
});
test('an unanchored tomorrow needs a real date and completing it does not imply attendance', () => {
  const state = demoReducer(initialDemoState(), { type: 'capture', sampleId: 'missing-date' }); const proposal = state.proposals[0]!;
  assert.equal(proposal.event.date, undefined); assert.deepEqual(proposal.unresolvedFields, ['date']); assert.equal(state.events.length, 6);
  for (const date of ['', 'tomorrow', '2026-02-31', '2026-13-01']) { const invalid = demoReducer(state, { type: 'complete', proposalId: proposal.id, fields: { ...proposal.event, date } }); assert.equal(invalid.events.length, 6); assert.match(invalid.error, /real date/); }
  const action = { type: 'complete' as const, proposalId: proposal.id, fields: { ...proposal.event, date: '2026-09-20' } };
  const completed = demoReducer(state, action); assert.equal(completed.events.at(-1)!.attendance, 'invited'); assert.equal(completed.events.at(-1)!.date, '2026-09-20'); assert.equal(completed.proposals.length, 0);
  assert.equal(demoReducer(completed, action), completed);
  const confirmed = demoReducer(state, { ...action, fields: { ...action.fields, attendance: 'confirmed' } }); assert.equal(confirmed.events.at(-1)!.attendance, 'confirmed');
});
test('promotions are filtered and dismissed or removed samples do not return on repeated capture', () => {
  let state = demoReducer(initialDemoState(), { type: 'capture', sampleId: 'offer' }); assert.equal(state.handled.offer, 'filtered'); assert.equal(state.proposals.length, 0); assert.equal(state.events.length, 6);
  state = demoReducer(state, { type: 'capture', sampleId: 'missing-date' }); const proposal = state.proposals[0]!;
  state = demoReducer(state, { type: 'dismiss', proposalId: proposal.id }); assert.equal(state.handled['missing-date'], 'dismissed'); assert.equal(state.proposals.length, 0); assert.equal(demoReducer(state, { type: 'capture', sampleId: 'missing-date' }), state);
  state = demoReducer(state, { type: 'capture', sampleId: 'birthday' }); state = demoReducer(state, { type: 'remove', eventId: 'demo-birthday' });
  assert.equal(state.events.length, 6); assert.equal(state.handled.birthday, 'removed'); assert.equal(demoReducer(state, { type: 'capture', sampleId: 'birthday' }), state);
});
test('invitation titles have one display prefix and stay unprefixed when edited', () => {
  let state = demoReducer(initialDemoState(), { type: 'capture', sampleId: 'birthday' }); const event = state.events.at(-1)!;
  const fields = { ...event, title: 'INVITATION: invitation: Birthday drinks' }; assert.equal(demoTitle(fields), 'INVITATION: Birthday drinks');
  state = demoReducer(state, { type: 'edit', eventId: event.id, fields }); assert.equal(state.events.at(-1)!.title, 'Birthday drinks'); assert.equal(state.events.at(-1)!.attendance, 'invited');
  const markup = renderToStaticMarkup(createElement(DemoForm, { initial: fields, label: 'Save changes', onSave() {} }));
  assert.match(markup, /value="Birthday drinks"/); assert.match(markup, /<input(?=[^>]*value="invited")(?=[^>]*checked="")[^>]*>/); assert.match(markup, /No RSVP is sent/);
});
test('editing and removal preserve identity, and reset fully restores independent fixtures', () => {
  let state = initialDemoState(); const first = state.events[0]!; state = demoReducer(state, { type: 'edit', eventId: first.id, fields: { ...first, title: 'Changed sample', time: '' } });
  assert.equal(state.events[0]!.id, first.id); assert.equal(state.events[0]!.revision, 2); assert.equal(state.events[0]!.time, undefined); assert.equal(INITIAL_EVENTS[0]!.title, 'Dinner at Luca');
  state = demoReducer(state, { type: 'remove', eventId: first.id }); assert.equal(state.events.length, 5); state = demoReducer(state, { type: 'capture', sampleId: 'birthday' }); state = demoReducer(state, { type: 'reset' });
  assert.deepEqual(state.events, INITIAL_EVENTS); assert.deepEqual(state.proposals, []); assert.deepEqual(state.handled, {}); assert.equal(state.error, ''); assert.equal(initialDemoState().events[0] === state.events[0], false);
  assert.equal(SAMPLES.find(sample => sample.id === 'missing-date')!.proposal!.event.date, undefined);
});
test('month and selected-day markup expose the invitation label without changing kind styling', () => {
  const state = demoReducer(initialDemoState(), { type: 'capture', sampleId: 'birthday' });
  const markup = renderToStaticMarkup(createElement(DemoMonth, { events: state.events, year: 2026, month: 8, selected: '2026-09-19', peek: true, onSelect() {}, onPeek() {}, onEvent() {} }));
  assert.match(markup, /class="event-full">INVITATION: Alex’s birthday/);
  assert.match(markup, /<strong>INVITATION: Alex’s birthday<\/strong>/);
  assert.match(markup, /class="calendar-event kind-social /);
});
test('date and booking validation preserves absent times and rejects impossible journeys', () => {
  assert.equal(validDemoDate('2028-02-29'), true); assert.equal(validDemoDate('2026-02-29'), false); assert.equal(validDemoDate('0000-01-01'), false);
  assert.equal(validateDemoFields(INITIAL_EVENTS.find(event => event.kind === 'stay')!), null);
  const flight = INITIAL_EVENTS.find(event => event.id === 'seed-flight')!; assert.equal(validateDemoFields(flight), null); assert.match(validateDemoFields({ ...flight, time: '15:00' })!, /after the start/);
  assert.equal(validateDemoFields({ ...flight, endDate: '2026-09-23', time: '23:00', endTime: '02:00' }), null);
  assert.match(validateDemoFields({ ...INITIAL_EVENTS[0]!, title: '  ' })!, /title/); assert.match(validateDemoFields({ ...INITIAL_EVENTS[0]!, date: '2026-10-25', time: '01:30' })!, /clock change/);
});
test('clearing or invalidating a stay checkout cannot silently remove its saved checkout', () => {
  const state = initialDemoState(); const hotel = state.events.find(event => event.kind === 'stay')!;
  for (const endDate of ['', undefined, '2026-02-31', hotel.date]) {
    const fields = { ...hotel, endDate }; assert.ok(validateDemoFields(fields));
    const rejected = demoReducer(state, { type: 'edit', eventId: hotel.id, fields });
    assert.equal(rejected.events.find(event => event.id === hotel.id)!.endDate, '2026-09-13'); assert.equal(rejected.events.find(event => event.id === hotel.id)!.revision, 1); assert.ok(rejected.error);
  }
  const saved = demoReducer(state, { type: 'edit', eventId: hotel.id, fields: { ...hotel, endDate: '2026-09-14' } }); assert.equal(saved.events.find(event => event.id === hotel.id)!.endDate, '2026-09-14'); assert.equal(saved.error, '');
});
test('reopening a stay without a checkout still shows a required blank checkout field', () => {
  const hotel = INITIAL_EVENTS.find(event => event.kind === 'stay')!;
  const markup = renderToStaticMarkup(createElement(DemoForm, { initial: { ...hotel, endDate: undefined }, label: 'Save changes', onSave() {} }));
  assert.match(markup, /Checkout date/); const input = markup.match(/<input\b[^>]*id="[^"]*-end-date"[^>]*>/)?.[0]; assert.ok(input); assert.match(input, /\brequired=""/); assert.match(input, /\bvalue=""/);
});
test('month layout starts Monday, handles leap years and shows a stay checkout explicitly', () => {
  const days = monthCells(2026, 8); assert.equal(days.length, 35); assert.equal(days[0]!.getUTCDay(), 1); assert.equal(days[0]!.toISOString().slice(0, 10), '2026-08-31');
  assert.ok(monthCells(2028, 1).some(date => date.toISOString().startsWith('2028-02-29')));
  const hotel = INITIAL_EVENTS.find(event => event.kind === 'stay')!; assert.equal(eventsOnDate([...INITIAL_EVENTS], '2026-09-12').some(event => event.id === hotel.id), true); assert.match(timeOnDay(hotel, '2026-09-13'), /^Checkout/); assert.equal(eventsOnDate([...INITIAL_EVENTS], '2026-09-14').some(event => event.id === hotel.id), false);
});
test('the public demo has no runtime imports of personal integrations or network and storage capabilities', () => {
  const directory = resolve(import.meta.dirname, '../app/demo'); const allowedPackages = new Set(['react', 'react-dom', 'lucide-react', '@/components/ui/button', '@/components/ui/dialog', '@/components/ui/input', '@/components/ui/textarea']);
  for (const file of readdirSync(directory).filter(file => /\.(ts|tsx)$/.test(file))) {
    const source = readFileSync(resolve(directory, file), 'utf8'); const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const target = (statement.moduleSpecifier as ts.StringLiteral).text;
      assert.ok(target.startsWith('./') || target === '../calendar/calendar.css' || allowedPackages.has(target), `${file}: unexpected runtime import ${target}`);
    }
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|Notification|navigator)\b|process\.env|\bimport\s*\(/, `${file}: demo must remain isolated`);
  }
});
