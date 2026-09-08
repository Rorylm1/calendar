import test from 'node:test';
import assert from 'node:assert/strict';
import { fields, fixture, proposal, source } from './helpers.ts';
import type { Proposal } from '../src/domain.ts';
import type { Store } from '../src/store.ts';

function add(store: Store, patch: Partial<Parameters<typeof proposal>[0]> = {}) {
  const item = store.putProposal(proposal(patch))!;
  assert.ok(item); return item;
}
function apply(store: Store, patch: Parameters<typeof proposal>[0] = {}) {
  const item = add(store, patch); const counts = store.autoApplyPending({ proposalIds: [item.id] });
  return { item: store.get<Proposal>('proposals', item.id)!, counts, event: store.events()[0]! };
}

test('dated bookings are confirmed, invitations and uncertain attendance are invited, and source evidence survives', () => {
  const { store } = fixture();
  for (const attendance of ['confirmed', 'invited', 'unknown'] as const) {
    const result = apply(store, { attendance, event: fields({ title: attendance }) });
    const event = store.events().find(event => event.title === attendance)!;
    assert.equal(event.attendance, attendance === 'confirmed' ? 'confirmed' : 'invited');
    assert.equal(result.item.attendance, attendance); assert.equal(result.item.status, 'confirmed');
    assert.equal(result.item.appliedBy, 'automatic'); assert.equal(result.item.outcome, 'created');
    assert.deepEqual(result.item.evidence, proposal().evidence); assert.ok(result.item.appliedAt);
  }
  assert.equal(store.events().length, 3); store.close();
});

test('preview rolls back every record, then applying existing pending is idempotent and requires no source payload', () => {
  const { store } = fixture(); const first = add(store); const second = add(store, { attendance: 'invited' });
  const before = store.db.prepare('SELECT * FROM records ORDER BY bucket,id').all();
  assert.deepEqual(store.autoApplyPending({ dryRun: true }), { created: 1, updated: 0, cancelled: 0, duplicate: 1, suppressed: 0, needsDetails: 0 });
  assert.deepEqual(store.db.prepare('SELECT * FROM records ORDER BY bucket,id').all(), before); assert.equal(store.events().length, 0);
  assert.equal(store.autoApplyPending().created, 1); assert.equal(store.events().length, 1);
  assert.equal(store.get<Proposal>('proposals', first.id)!.outcome, 'created'); assert.equal(store.get<Proposal>('proposals', second.id)!.outcome, 'duplicate');
  assert.deepEqual(store.autoApplyPending(), { created: 0, updated: 0, cancelled: 0, duplicate: 0, suppressed: 0, needsDetails: 0 }); store.close();
});

test('date-only invitations are valid; absent dates, hard ambiguity, attachments and missing evidence remain exceptions', () => {
  const { store } = fixture();
  assert.equal(apply(store, { attendance: 'invited', event: fields({ time: undefined }), unresolvedFields: ['time', 'attendance'] }).counts.created, 1);
  for (const patch of [
    { event: fields({ date: undefined }) }, { unresolvedFields: ['attachment'] }, { unresolvedFields: ['time'] },
    { unresolvedFields: ['date is either Tuesday or Thursday'] }, { evidence: [] },
    { event: fields({ date: '2026-10-25', time: '01:30' }) },
  ]) assert.equal(apply(store, patch).counts.needsDetails, 1);
  assert.equal(store.events().length, 1); store.close();
});

test('absent optional location, reference and checkout date do not block a dated plan, while conflicting supplied values do', () => {
  const { store } = fixture();
  assert.equal(apply(store, { event: fields({ location: '', reference: undefined, endDate: undefined }), unresolvedFields: ['location', 'reference', 'endDate'] }).counts.created, 1);
  assert.equal(apply(store, { event: fields({ title: 'Conflicting location' }), unresolvedFields: ['location'] }).counts.needsDetails, 1); store.close();
});

test('similar bookings at distinct venues or in distinct zones are not duplicates; cancellation cannot target the competing event', () => {
  const { store } = fixture(); const first = apply(store, { event: fields({ location: 'Place A', time: '18:00' }) }).event;
  const second = apply(store, { event: fields({ location: 'Place B', time: '20:00' }) }); assert.equal(second.counts.created, 1);
  assert.equal(apply(store, { event: fields({ location: 'Place C', time: '18:00' }) }).counts.created, 1);
  assert.equal(apply(store, { action: 'cancel', targetEventId: first.id, targetRevision: 1, event: fields({ location: 'Place B', time: '20:00' }) }).counts.needsDetails, 1);
  assert.equal(store.events().length, 3);
  assert.equal(apply(store, { event: fields({ title: 'Remote session', timeZone: 'Europe/London' }) }).counts.created, 1);
  assert.equal(apply(store, { event: fields({ title: 'Remote session', timeZone: 'Europe/Paris' }) }).counts.created, 1); store.close();
});

test('newer unchanged updates and exact fingerprint replays advance chronology before older changes arrive', () => {
  for (const exactReplay of [false, true]) {
    const { store } = fixture(); store.capture({ ...source(), receivedAt: '2026-09-07T08:00:00Z' }); const initial = apply(store).event;
    store.capture({ ...source('noon'), receivedAt: '2026-09-07T12:00:00Z' });
    if (exactReplay) assert.equal(store.putProposal(proposal({ sourceMessageIds: ['noon'] })), undefined);
    else assert.equal(apply(store, { action: 'update', targetEventId: initial.id, targetRevision: 1, sourceMessageIds: ['noon'] }).counts.duplicate, 1);
    store.capture({ ...source('ten'), receivedAt: '2026-09-07T10:00:00Z' });
    const older = apply(store, { action: 'update', targetEventId: initial.id, targetRevision: 1, event: fields({ time: '20:00' }), sourceMessageIds: ['ten'] });
    assert.equal(older.counts.duplicate, 1); assert.equal(older.event.time, '19:30'); assert.equal(older.event.revision, 1); store.close();
  }
});

test('automatic apply rolls back all partial event, proposal and export writes when durable storage fails', () => {
  const { store } = fixture(); add(store); add(store, { event: fields({ title: 'Second booking' }) });
  const before = store.db.prepare('SELECT * FROM records ORDER BY bucket,id').all(); const originalPut = store.put.bind(store); let eventWrites = 0;
  store.put = (bucket, id, value) => { if (bucket === 'events' && ++eventWrites === 2) throw new Error('Synthetic durable write failure'); originalPut(bucket, id, value); };
  assert.throws(() => store.autoApplyPending(), /durable write/); assert.deepEqual(store.db.prepare('SELECT * FROM records ORDER BY bucket,id').all(), before);
  store.put = originalPut; assert.equal(store.autoApplyPending().created, 2); assert.equal(store.events().length, 2); assert.equal(store.autoApplyPending().created, 0); store.close();
});

test('accepting an invitation updates the existing event without downgrading it on later invitation reminders', () => {
  const { store } = fixture(); const original = apply(store, { attendance: 'invited' }).event;
  const accepted = apply(store, { attendance: 'confirmed' }); assert.equal(accepted.counts.updated, 1);
  assert.equal(accepted.event.id, original.id); assert.equal(accepted.event.attendance, 'confirmed'); assert.equal(accepted.event.revision, 2);
  const reminder = apply(store, { action: 'update', targetEventId: original.id, targetRevision: 2, attendance: 'invited' });
  assert.equal(reminder.counts.duplicate, 1); assert.equal(reminder.event.attendance, 'confirmed'); assert.equal(reminder.event.revision, 2); store.close();
});

test('explicit owner attendance overrides survive automatic acceptance while manual details and removed fields survive updates', () => {
  const { store } = fixture(); const original = apply(store, { attendance: 'invited', event: fields({ reference: 'BOOK-1' }) }).event;
  const edited = store.patchEvent(original.id, { attendance: 'invited', detail: 'Bring umbrella', location: '', reminderMinutes: null }, 1);
  const accepted = apply(store, { action: 'update', targetEventId: edited.id, targetRevision: edited.revision, event: fields({ time: '20:00', reference: 'BOOK-1' }) });
  assert.equal(accepted.counts.updated, 1); assert.equal(accepted.event.time, '20:00'); assert.equal(accepted.event.attendance, 'invited');
  assert.equal(accepted.event.detail, 'Bring umbrella'); assert.equal(accepted.event.location, ''); assert.equal(accepted.event.reminderMinutes, null);
  const conflict = apply(store, { action: 'update', targetEventId: edited.id, targetRevision: accepted.event.revision, event: fields({ location: 'A different restaurant', reference: 'BOOK-1' }) });
  assert.equal(conflict.counts.needsDetails, 1); assert.ok(conflict.item.unresolvedFields.includes('ownerEdited:location')); store.close();
});

test('duplicate old booking details cannot undo a manual time change or create a second entry', () => {
  const { store } = fixture(); const original = apply(store).event; store.patchEvent(original.id, { time: '21:00' }, 1);
  const repeat = apply(store, { event: fields({ detail: 'Reminder copy' }) });
  assert.equal(repeat.counts.duplicate, 1); assert.equal(repeat.event.time, '21:00'); assert.equal(store.events().length, 1); store.close();
});

test('dismissed, explicitly declined and owner-deleted plans are never resurrected by changed invitation copies', () => {
  for (const mode of ['dismiss', 'decline', 'delete'] as const) {
    const { store } = fixture();
    if (mode === 'dismiss') store.dismiss(add(store).id);
    if (mode === 'decline') assert.equal(apply(store, { attendance: 'declined' }).counts.suppressed, 1);
    if (mode === 'delete') { const event = apply(store).event; store.deleteEvent(event.id, 1); }
    const repeated = apply(store, { attendance: 'invited', event: fields({ detail: 'Another invitation copy', time: '20:00' }) });
    assert.equal(repeated.counts.suppressed, 1, mode); assert.equal(store.events().length, 0); store.close();
  }
});

test('automatic cancellations require a matching current target and preserve cancellation evidence attendance', () => {
  const { store } = fixture(); const original = apply(store).event;
  const unmatched = apply(store, { action: 'cancel', targetEventId: 'unknown', targetRevision: 1 }); assert.equal(unmatched.counts.needsDetails, 1);
  const wrong = apply(store, { action: 'cancel', targetEventId: original.id, targetRevision: 1, event: fields({ title: 'Different appointment' }) }); assert.equal(wrong.counts.needsDetails, 1);
  const cancelled = apply(store, { action: 'cancel', targetEventId: original.id, targetRevision: 1, attendance: 'unknown' });
  assert.equal(cancelled.counts.cancelled, 1); assert.equal(cancelled.item.attendance, 'unknown'); assert.equal(store.events().length, 0);
  assert.equal(apply(store, { event: fields({ detail: 'Old reminder' }) }).counts.suppressed, 1); store.close();
});

test('stale proposals and legacy or manual events retain owner resolution guards', () => {
  const { store } = fixture(); const event = apply(store).event; store.patchEvent(event.id, { time: '22:00' }, 1);
  assert.equal(apply(store, { action: 'update', targetEventId: event.id, targetRevision: 1, event: fields({ time: '20:00' }) }).counts.needsDetails, 1);
  const manual = store.createEvent(fields({ title: 'Manual booking' }));
  assert.equal(apply(store, { action: 'cancel', targetEventId: manual.id, targetRevision: 1, event: fields({ title: manual.title }) }).counts.needsDetails, 1);
  store.remove('event_automation', event.id);
  assert.equal(apply(store, { action: 'cancel', targetEventId: event.id, targetRevision: 2 }).counts.needsDetails, 1); store.close();
});

test('older-source updates and cancellations cannot undo a newer change; original dated identities still deduplicate', () => {
  const { store } = fixture(); store.capture(source()); const initial = apply(store, { event: fields({ reference: 'BOOK-1' }) }).event;
  store.capture({ ...source('new'), receivedAt: '2026-09-08T12:00:00Z' });
  const moved = apply(store, { action: 'update', targetEventId: initial.id, targetRevision: 1, event: fields({ date: '2026-09-09', reference: 'BOOK-1' }), sourceMessageIds: ['new'] });
  assert.equal(moved.counts.updated, 1);
  const stale = apply(store, { action: 'cancel', targetEventId: initial.id, targetRevision: 2, event: fields({ reference: 'BOOK-1' }) });
  assert.equal(stale.counts.duplicate, 1); assert.equal(store.events().length, 1);
  const copied = apply(store, { event: fields({ detail: 'Earlier confirmation copy', reference: 'BOOK-1' }) });
  assert.equal(copied.counts.duplicate, 1); assert.equal(copied.event.date, '2026-09-09'); store.close();
});

test('missing model optional values do not erase known ends, zones, references or reminders', () => {
  const { store } = fixture(); const initial = apply(store, { event: fields({ endTime: '21:00', timeZone: 'Europe/London', reference: 'BOOK-1', reminderMinutes: 30 }) }).event;
  const updated = apply(store, { action: 'update', targetEventId: initial.id, targetRevision: 1, event: fields({ time: '20:00' }) });
  assert.equal(updated.counts.updated, 1); assert.equal(updated.event.endTime, '21:00'); assert.equal(updated.event.reference, 'BOOK-1'); assert.equal(updated.event.timeZone, 'Europe/London'); assert.equal(updated.event.reminderMinutes, 30); store.close();
});

test('explicit exception confirmation respects chosen invitation attendance and preserves original source classification', () => {
  const { store } = fixture(); const item = add(store, { attendance: 'unknown', event: fields({ date: undefined }), unresolvedFields: ['date'] });
  const result = store.confirm(item.id, { date: '2026-09-19', attendance: 'invited' });
  assert.equal(result.event!.attendance, 'invited'); assert.equal(result.proposal.attendance, 'unknown'); assert.equal(result.proposal.appliedBy, 'owner');
  assert.equal(store.createEvent(fields({ title: 'Manual' })).attendance, 'confirmed');
  const legacy = { ...result.event! }; delete legacy.attendance; store.put('events', legacy.id, legacy);
  assert.equal(store.requireEvent(legacy.id).attendance, 'confirmed'); store.close();
});
