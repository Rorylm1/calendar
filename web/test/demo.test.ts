import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DemoForm from '../app/demo/demo-form.tsx';
import { demoReducer, initialDemoState, validDemoDate, validateDemoFields } from '../app/demo/state.ts';
import { INITIAL_EVENTS, SAMPLES } from '../app/demo/fixtures.ts';
import { eventsOnDate, monthCells, timeOnDay } from '../app/demo/dates.ts';

test('fictional dinner flows from message through edited suggestion to exactly one calendar plan', () => {
  const initial = initialDemoState(); let state = demoReducer(initial, { type: 'capture', sampleId: 'dinner' });
  assert.equal(state.events.length, 6); assert.equal(state.proposals.length, 1); assert.equal(state.proposals[0]!.source, 'Sample email'); assert.match(state.proposals[0]!.evidence[0]!, /table for four/);
  const proposal = state.proposals[0]!; const fields = { ...proposal.event, title: 'Dinner with friends', date: '2026-09-18', time: '20:00' };
  state = demoReducer(state, { type: 'confirm', proposalId: proposal.id, fields, attending: true });
  assert.equal(state.proposals.length, 0); assert.equal(state.events.length, 7); assert.equal(state.events.at(-1)!.date, fields.date); assert.equal(state.events.at(-1)!.title, fields.title); assert.equal(state.handled.dinner, 'confirmed');
  assert.equal(demoReducer(state, { type: 'confirm', proposalId: proposal.id, fields, attending: true }), state);
  assert.equal(demoReducer(state, { type: 'capture', sampleId: 'dinner' }), state); assert.equal(initial.events.length, 6); assert.equal(initial.proposals.length, 0);
});
test('a birthday invitation needs an explicit attendance decision', () => {
  const state = demoReducer(initialDemoState(), { type: 'capture', sampleId: 'birthday' }); const proposal = state.proposals[0]!; assert.equal(proposal.attendance, 'invited');
  const blocked = demoReducer(state, { type: 'confirm', proposalId: proposal.id, fields: proposal.event, attending: false }); assert.match(blocked.error, /Confirm you’re going/); assert.equal(blocked.events.length, 6); assert.equal(blocked.proposals.length, 1);
  const accepted = demoReducer(state, { type: 'confirm', proposalId: proposal.id, fields: proposal.event, attending: true }); assert.equal(accepted.events.at(-1)!.date, '2026-09-19'); assert.equal(accepted.handled.birthday, 'confirmed');
});
test('an unanchored tomorrow stays undated until the visitor supplies a valid date', () => {
  const state = demoReducer(initialDemoState(), { type: 'capture', sampleId: 'missing-date' }); const proposal = state.proposals[0]!; assert.equal(proposal.event.date, undefined); assert.deepEqual(proposal.unresolvedFields, ['date']);
  for (const date of ['', 'tomorrow', '2026-02-31', '2026-13-01']) { const invalid = demoReducer(state, { type: 'confirm', proposalId: proposal.id, fields: { ...proposal.event, date }, attending: true }); assert.equal(invalid.events.length, 6); assert.match(invalid.error, /real date/); }
  const confirmed = demoReducer(state, { type: 'confirm', proposalId: proposal.id, fields: { ...proposal.event, date: '2026-09-20' }, attending: true }); assert.equal(confirmed.events.at(-1)!.date, '2026-09-20');
});
test('promotions create no suggestion and repeated capture or dismiss does not bring handled samples back', () => {
  let state = demoReducer(initialDemoState(), { type: 'capture', sampleId: 'offer' }); assert.equal(state.handled.offer, 'filtered'); assert.equal(state.proposals.length, 0); assert.equal(state.events.length, 6);
  state = demoReducer(state, { type: 'capture', sampleId: 'dinner' }); const proposal = state.proposals[0]!; assert.equal(demoReducer(state, { type: 'capture', sampleId: 'dinner' }), state);
  state = demoReducer(state, { type: 'dismiss', proposalId: proposal.id }); assert.equal(state.handled.dinner, 'dismissed'); assert.equal(state.proposals.length, 0); assert.equal(demoReducer(state, { type: 'capture', sampleId: 'dinner' }), state);
});
test('editing and removal preserve identity, and reset fully restores independent fixtures', () => {
  let state = initialDemoState(); const first = state.events[0]!; state = demoReducer(state, { type: 'edit', eventId: first.id, fields: { ...first, title: 'Changed sample', time: '' } });
  assert.equal(state.events[0]!.id, first.id); assert.equal(state.events[0]!.revision, 2); assert.equal(state.events[0]!.time, undefined); assert.equal(INITIAL_EVENTS[0]!.title, 'Dinner at Luca');
  state = demoReducer(state, { type: 'remove', eventId: first.id }); assert.equal(state.events.length, 5); state = demoReducer(state, { type: 'capture', sampleId: 'birthday' }); state = demoReducer(state, { type: 'reset' });
  assert.deepEqual(state.events, INITIAL_EVENTS); assert.deepEqual(state.proposals, []); assert.deepEqual(state.handled, {}); assert.equal(state.error, ''); assert.equal(initialDemoState().events[0] === state.events[0], false);
  assert.equal(SAMPLES.find(sample => sample.id === 'missing-date')!.proposal!.event.date, undefined);
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
