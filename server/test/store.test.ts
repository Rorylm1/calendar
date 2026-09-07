import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Vault } from '../src/crypto.ts';
import { fixture, fields, proposal } from './helpers.ts';
import { ProcessingPaused } from '../src/errors.ts';

test('encrypted records bind payload to its record id and reject tampering', () => {
  const vault = new Vault(randomBytes(32).toString('base64')); const ciphertext = vault.seal({ refreshToken: 'private-token' }, 'token:one');
  assert.ok(!ciphertext.includes('private-token')); assert.deepEqual(vault.open(ciphertext, 'token:one'), { refreshToken: 'private-token' });
  assert.throws(() => vault.open(ciphertext, 'token:two')); const pieces = ciphertext.split('.'); pieces[2] = Buffer.alloc(16).toString('base64'); assert.throws(() => vault.open(pieces.join('.'), 'token:one'));
});
test('source and event content are encrypted in SQLite, not just OAuth credentials', () => {
  const { store } = fixture(); store.createEvent(fields({ title: 'Private dinner title' }));
  const raw = JSON.stringify(store.db.prepare('SELECT * FROM records').all()); assert.ok(!raw.includes('Private dinner title')); store.close();
});
test('confirmation is approval-only and idempotent; repeat preserves one event', () => {
  const { store } = fixture(); const item = store.putProposal(proposal())!; assert.equal(store.events().length, 0);
  const first = store.confirm(item.id); const second = store.confirm(item.id); assert.deepEqual(second, first); assert.equal(store.events().length, 1); store.close();
});
test('manual edits make an update and cancellation stale without partial changes', () => {
  const { store } = fixture(); const event = store.createEvent(fields());
  const update = store.putProposal(proposal({ action: 'update', targetEventId: event.id, targetRevision: 1, event: fields({ time: '20:00' }) }))!;
  const cancel = store.putProposal(proposal({ action: 'cancel', targetEventId: event.id, targetRevision: 1 }))!;
  store.patchEvent(event.id, { time: '21:00' }, 1);
  assert.throws(() => store.confirm(update.id, {}, 2), /changed/); assert.throws(() => store.confirm(cancel.id), /changed/);
  assert.equal(store.events()[0]!.time, '21:00'); assert.equal(store.proposals().find(p => p.id === update.id)!.status, 'pending'); store.close();
});
test('missing date requires explicit resolution, missing time remains absent', () => {
  const { store } = fixture(); const item = store.putProposal(proposal({ event: fields({ date: undefined, time: undefined }), unresolvedFields: ['date'] }))!;
  assert.throws(() => store.confirm(item.id)); assert.equal(store.events().length, 0);
  const event = store.confirm(item.id, { date: '2026-09-19' }).event!; assert.equal(event.date, '2026-09-19'); assert.equal(event.time, undefined); store.close();
});
test('date-only stays and cross-zone overnight travel preserve supplied values', () => {
  const { store } = fixture(); const stay = store.createEvent(fields({ title: 'Hotel', kind: 'stay', date: '2026-09-11', endDate: '2026-09-13', time: undefined }));
  assert.equal(stay.time, undefined); assert.equal(stay.endDate, '2026-09-13');
  const flight = store.createEvent(fields({ title: 'Overnight flight', kind: 'travel', date: '2026-09-22', time: '22:00', timeZone: 'America/New_York', endDate: '2026-09-23', endTime: '10:00', endTimeZone: 'Europe/London' }));
  assert.equal(flight.endDate, '2026-09-23'); assert.equal(flight.endTimeZone, 'Europe/London'); store.close();
});
test('dismissed duplicates stay dismissed; materially changed proposals can return', () => {
  const { store } = fixture(); const item = store.putProposal(proposal())!; store.dismiss(item.id);
  assert.equal(store.putProposal(proposal({ sourceMessageIds: ['m2'] })), undefined);
  assert.ok(store.putProposal(proposal({ event: fields({ time: '20:00' }), sourceMessageIds: ['m3'] }))); assert.equal(store.proposals().filter(p => p.status === 'pending').length, 1); store.close();
});
test('OAuth state is owner-bound, expiring, and single use', () => {
  const { store } = fixture(); store.createOAuthState('state-one', 'owner', 'verifier', 1000);
  assert.throws(() => store.consumeOAuthState('state-one', 'stranger', 1100)); assert.equal(store.consumeOAuthState('state-one', 'owner', 1100), 'verifier'); assert.throws(() => store.consumeOAuthState('state-one', 'owner', 1100));
  store.createOAuthState('state-two', 'owner', 'verifier', 1000); assert.throws(() => store.consumeOAuthState('state-two', 'owner', 601001)); store.close();
});
test('budget reservations prevent overspend and settle measured usage', () => {
  const { store } = fixture(); const id = store.reserve(0.8, 1); assert.throws(() => store.reserve(0.3, 1), ProcessingPaused); store.settleUsage(id, 0.1); assert.equal(store.spend(), 0.1); assert.ok(store.reserve(0.3, 1)); store.close();
});
test('cross-zone and aliased-zone events must still end after they start', () => {
  const { store } = fixture();
  assert.throws(() => store.createEvent(fields({ date: '2026-09-22', time: '18:00', timeZone: 'Europe/London', endDate: '2026-09-21', endTime: '09:00', endTimeZone: 'Europe/Paris' })), /before/);
  assert.throws(() => store.createEvent(fields({ time: '18:00', timeZone: 'Europe/London', endTime: '17:00', endTimeZone: 'GB' })), /before/);
  assert.throws(() => store.createEvent(fields({ time: '18:00', endTime: '17:00', endTimeZone: 'Europe/Paris' })), /arrival/);
  assert.throws(() => store.createEvent(fields({ date: '2026-03-29', time: '01:30', timeZone: 'Europe/London' })), /clocks change/); store.close();
});
test('fresh proposals targeting a new event revision are not deduped into stale proposals', () => {
  const { store } = fixture(); const event = store.createEvent(fields());
  const stale = store.putProposal(proposal({ action: 'update', targetEventId: event.id, targetRevision: 1, event: fields({ time: '20:00' }) }))!;
  store.patchEvent(event.id, { detail: 'Manual note' }, 1);
  const fresh = store.putProposal(proposal({ action: 'update', targetEventId: event.id, targetRevision: 2, event: fields({ time: '20:00' }) }))!;
  assert.ok(fresh); assert.notEqual(fresh.id, stale.id); assert.equal(store.confirm(fresh.id).event!.time, '20:00'); store.close();
});
test('failed messages cannot starve fresh captures and retries eventually require action', () => {
  const { store } = fixture();
  for (let i = 0; i < 100; i++) { const id = `failed-${i}`; store.capture({ id, threadId: id, from: '', to: '', subject: '', receivedAt: '', sentByOwner: false, text: 'Synthetic', context: [], unsupportedAttachments: [] }); store.sourceStatus(id, 'processing'); store.sourceStatus(id, 'processing', { decision: 'relevant' }); store.sourceStatus(id, 'failed'); }
  store.capture({ id: 'fresh', threadId: 'fresh', from: '', to: '', subject: '', receivedAt: '', sentByOwner: false, text: 'New booking', context: [], unsupportedAttachments: [] });
  assert.equal(store.pending(100)[0]!.id, 'fresh'); assert.equal((store.db.prepare('SELECT attempts FROM sources WHERE id=?').get('failed-0') as { attempts: number }).attempts, 1);
  store.db.prepare("UPDATE sources SET attempts=3,next_attempt_at=0 WHERE status='failed'").run(); assert.equal(store.pending(100, Date.now() + 1e9).length, 1); store.retryFailures(); assert.equal(store.pending(200).length, 101); store.close();
});
