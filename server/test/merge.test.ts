import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { buildApp } from '../src/app.ts';
import { fixture, fields, proposal } from './helpers.ts';

test('merge keeps identity, timing, attendance and conflicting owner details; fills only blank descriptive fields', () => {
  const { store } = fixture();
  try {
    const keep = store.createEvent(fields({ attendance: 'invited', time: undefined, location: '', detail: 'Owner note', reminderMinutes: null }));
    const duplicate = store.createEvent(fields({ time: '20:00', location: 'Luca restaurant', detail: 'Different note', reference: 'BOOKING-1' }), 'Gmail');
    const merged = store.mergeEvents(keep.id, duplicate.id, keep.revision, duplicate.revision);
    assert.equal(store.events().length, 1); assert.equal(merged.id, keep.id); assert.equal(merged.revision, 2);
    assert.equal(merged.attendance, 'invited'); assert.equal(merged.time, undefined); assert.equal(merged.reminderMinutes, null);
    assert.equal(merged.detail, 'Owner note'); assert.equal(merged.location, 'Luca restaurant'); assert.equal(merged.reference, 'BOOKING-1');
    assert.deepEqual(store.get<{ duplicate: unknown }>('event_merges', duplicate.id)?.duplicate, duplicate);
    assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM records').all()).includes('Different note'), false);
  } finally { store.close(); }
});

test('merge rejects stale revisions, self-merge and missing events without partial deletion', () => {
  const { store } = fixture();
  try {
    const keep = store.createEvent(fields()); const other = store.createEvent(fields());
    store.patchEvent(other.id, { detail: 'Changed meanwhile' }, 1);
    assert.throws(() => store.mergeEvents(keep.id, other.id, 1, 1), /changed/);
    assert.throws(() => store.mergeEvents(keep.id, other.id, 2, 2), /changed/);
    assert.throws(() => store.mergeEvents(keep.id, keep.id, 1, 1), /different event/);
    assert.throws(() => store.mergeEvents(keep.id, 'missing', 1, 1), /no longer/);
    assert.equal(store.events().length, 2); assert.equal(store.requireEvent(keep.id).revision, 1);
    assert.equal(store.all('deleted_events').length, 0);
  } finally { store.close(); }
});

test('merged duplicates and their historical names stay removed on reimport, including after keeper deletion', () => {
  const { store } = fixture();
  try {
    const keep = store.createEvent(fields({ title: 'Dinner with Alex' }));
    const other = store.createEvent(fields({ title: 'Luca booking' }));
    store.put('event_automation', other.id, { baseline: fields({ title: 'Luca booking' }), managed: true, ownerFields: [], identities: [fields({ title: 'Your restaurant booking' })] });
    const merged = store.mergeEvents(keep.id, other.id, 1, 1);
    store.putProposal(proposal({ event: fields({ title: 'Luca booking' }), sourceMessageIds: ['second-inbox'] }));
    store.putProposal(proposal({ event: fields({ title: 'Your restaurant booking' }), sourceMessageIds: ['whatsapp'] }));
    assert.equal(store.autoApplyPending().suppressed, 2); assert.equal(store.events().length, 1);
    store.deleteEvent(merged.id, merged.revision);
    store.putProposal(proposal({ event: fields({ title: 'Dinner with Alex', time: '20:00' }), sourceMessageIds: ['third-inbox'] }));
    assert.equal(store.autoApplyPending().suppressed, 1); assert.equal(store.events().length, 0);
  } finally { store.close(); }
});

test('authenticated merge updates the same private ICS subscription with one stable UID and newer sequence', async () => {
  const { store, config } = fixture();
  const { app } = buildApp({ ...config, CALENDAR_PUBLIC_ORIGIN: 'https://calendar.example.test' }, { store, schedule: false });
  const headers = { authorization: `Bearer ${config.CALENDAR_SERVICE_TOKEN}` };
  try {
    const keep = store.createEvent(fields({ attendance: 'invited', location: '', detail: '' }));
    const other = store.createEvent(fields({ title: 'Restaurant booking', location: 'Luca', detail: 'Table outside' }));
    const feed = (await app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers })).json();
    const feedPath = new URL(feed.url).pathname;
    const readFeed = async () => new ICAL.Component(ICAL.parse((await app.inject({ method: 'GET', url: feedPath })).body)).getAllSubcomponents('vevent');
    const before = await readFeed(); assert.equal(before.length, 2);
    const keeperBefore = before.find(event => String(event.getFirstPropertyValue('summary')).includes(keep.title))!;
    const payload = { duplicateId: other.id, expectedRevision: 1, duplicateRevision: 1 };
    const url = `/v1/events/${keep.id}/merge`;
    assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...payload, duplicateRevision: 0 } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url, headers, payload })).statusCode, 200);
    const after = await readFeed(); assert.equal(after.length, 1);
    assert.equal(after[0]!.getFirstPropertyValue('uid'), keeperBefore.getFirstPropertyValue('uid'));
    assert.equal(after[0]!.getFirstPropertyValue('sequence'), 1);
    assert.equal(after[0]!.getFirstPropertyValue('summary'), `INVITATION: ${keep.title}`);
    assert.equal(after[0]!.getFirstPropertyValue('location'), 'Luca');
    assert.equal(after[0]!.getFirstPropertyValue('description'), 'Table outside');
    assert.equal(after[0]!.getAllSubcomponents('valarm').length, 0);
    assert.equal((await app.inject({ method: 'GET', url: '/v1/calendar/feed', headers })).json().url, feed.url);
    assert.equal((await app.inject({ method: 'POST', url, headers, payload })).statusCode, 409);
    assert.equal(store.events().length, 1);
  } finally { await app.close(); store.close(); }
});
