import test from 'node:test';
import assert from 'node:assert/strict';
import { ZoneValue } from '../src/domain.ts';
import { normalizeSourceTimeZones } from '../src/time-zones.ts';
import { renderCalendarFeed } from '../src/calendar-feed.ts';
import { CalendarWorker } from '../src/worker.ts';
import { fields, fixture, proposal, source, interpreter, output, provider } from './helpers.ts';

test('zone validation agrees with the calendar engine and rejects ambiguous legacy aliases', () => {
  for (const zone of ['BST', 'IST', 'Not/AZone']) assert.equal(ZoneValue.safeParse(zone).success, false);
  for (const zone of ['Europe/London', 'Asia/Kolkata', '+05:30', 'UTC', 'GB']) assert.equal(ZoneValue.safeParse(zone).success, true);
});

test('abbreviations require geographical or equivalent-clock evidence', () => {
  assert.equal(normalizeSourceTimeZones({ timeZone: 'BST' }, 'United Kingdom Time').event.timeZone, 'Europe/London');
  assert.deepEqual(normalizeSourceTimeZones({ timeZone: 'BST' }, 'A webinar at 3pm').unresolved, ['ambiguousTimeZone']);
  assert.deepEqual(normalizeSourceTimeZones({ timeZone: 'BST' }, 'London to Bangladesh').unresolved, ['ambiguousTimeZone']);
  assert.equal(normalizeSourceTimeZones({ timeZone: 'IST' }, '9:00 PM IST (3:30 PM GMT)').event.timeZone, '+05:30');
  assert.equal(normalizeSourceTimeZones({ timeZone: 'IST' }, 'Indian Standard Time').event.timeZone, 'Asia/Kolkata');
  assert.deepEqual(normalizeSourceTimeZones({ timeZone: 'IST' }, '9pm IST').unresolved, ['ambiguousTimeZone']);
});

test('a legacy BST dateTime flag repairs, passes normal deduplication, and exports the correct UTC instant', () => {
  const { store } = fixture();
  try {
    store.capture({ ...source(), text: 'United Kingdom Time' });
    const item = store.putProposal(proposal({ event: fields({ date: '2026-09-03', time: '15:30', endTime: '15:55', timeZone: 'BST', endTimeZone: 'BST' }), unresolvedFields: ['dateTime'] }))!;
    assert.equal(store.autoApplyPending({ dryRun: true }).created, 1);
    assert.equal(store.events().length, 0); assert.deepEqual(store.proposals()[0]!.unresolvedFields, ['dateTime']);
    assert.equal(store.proposals()[0]!.event.timeZone, 'BST');
    assert.equal(store.autoApplyPending().created, 1);
    assert.equal(store.proposals().find(p => p.id === item.id)!.status, 'confirmed');
    const feed = renderCalendarFeed(store).body;
    assert.match(feed, /DTSTART:20260903T143000Z/); assert.match(feed, /DTEND:20260903T145500Z/);
    assert.equal(store.autoApplyPending().created, 0); assert.equal(store.events().length, 1);
  } finally { store.close(); }
});

test('DST ambiguity, end-before-start, unknown abbreviations and unrelated missing facts still require details', () => {
  for (const event of [fields({ date: '2026-10-25', time: '01:30', timeZone: 'Europe/London' }), fields({ time: '20:00', endTime: '19:00', timeZone: 'Europe/London' }), fields({ timeZone: 'IST', location: '' })]) {
    const { store } = fixture();
    try { store.putProposal(proposal({ event, unresolvedFields: ['dateTime'] })); assert.equal(store.autoApplyPending().needsDetails, 1); assert.equal(store.autoApplyPending().needsDetails, 1); assert.equal(store.events().length, 0); } finally { store.close(); }
  }
  const { store } = fixture();
  try { store.putProposal(proposal({ event: fields({ timeZone: 'BST' }), unresolvedFields: ['dateTime', 'date'] })); assert.equal(store.autoApplyPending().needsDetails, 1); assert.equal(store.events().length, 0); } finally { store.close(); }
});

test('future model abbreviations normalize before validation; unknown zones become actionable proposals, not failed mail', async () => {
  for (const [zone, text, expected] of [['BST', 'United Kingdom Time', 1], ['IST', '9:00 PM IST', 0]] as const) {
    const { config, store } = fixture(); store.capture(source('mail', text));
    const worker = new CalendarWorker(config, store, () => provider(), interpreter(output(fields({ timeZone: zone, location: '' }), { evidence: [text] })));
    try { await worker.process(); assert.equal(store.events().length, expected); assert.equal(store.counts().failedMessages, 0); if (!expected) assert.ok(store.proposals()[0]!.unresolvedFields.includes('ambiguousTimeZone')); } finally { await worker.stop(); store.close(); }
  }
});
