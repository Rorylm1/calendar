import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ICAL from 'ical.js';
import { buildApp } from '../src/app.ts';
import { calendarFeedSettings, renderCalendarFeed } from '../src/calendar-feed.ts';
import { EventFields, EventPatch } from '../src/domain.ts';
import { hash } from '../src/crypto.ts';
import { Store, type EventExportMetadata } from '../src/store.ts';
import { fixture, fields, proposal, source } from './helpers.ts';

const origin = 'https://calendar.example.test';
const parse = (body: string) => new ICAL.Component(ICAL.parse(body));
const components = (body: string) => parse(body).getAllSubcomponents('vevent');
const events = (body: string) => components(body).map(component => new ICAL.Event(component));
const pathOf = (url: string) => new URL(url).pathname;
function setup(store?: Store) {
  const fixtureValue = fixture(); if (store) fixtureValue.store.close();
  const config = { ...fixtureValue.config, CALENDAR_PUBLIC_ORIGIN: origin };
  const selectedStore = store || fixtureValue.store;
  const { app } = buildApp(config, { store: selectedStore, schedule: false });
  return { app, config, store: selectedStore, headers: { authorization: `Bearer ${config.CALENDAR_SERVICE_TOKEN}` } };
}

test('feed controls require owner authentication; activation is deliberate and only its exact public route is exempt', async () => {
  const { app, config, store, headers } = setup();
  try {
    for (const [method, url] of [['GET', '/v1/calendar/feed'], ['POST', '/v1/calendar/feed/enable'], ['POST', '/v1/calendar/feed/rotate'], ['DELETE', '/v1/calendar/feed']] as const) {
      assert.equal((await app.inject({ method, url })).statusCode, 401);
      assert.equal((await app.inject({ method, url, headers: { 'x-openai-user-email': 'owner@example.test', 'x-calendar-owner': 'owner' } })).statusCode, 401);
    }
    const before = (await app.inject({ method: 'GET', url: '/v1/calendar/feed', headers })).json();
    assert.equal(before.configured, true); assert.equal(before.enabled, false); assert.equal(before.url, null);
    assert.equal(store.get('calendar_feed_grant'), undefined);
    const enabled = await app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers });
    assert.equal(enabled.statusCode, 200); assert.equal(enabled.headers['cache-control'], 'no-store'); assert.equal(enabled.headers['referrer-policy'], 'no-referrer');
    const settings = enabled.json(); const token = pathOf(settings.url).split('/').at(-1)!.slice(0, -4);
    assert.equal(Buffer.from(token, 'base64url').length, 32); assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(settings.webcalUrl, settings.url.replace('https:', 'webcal:'));
    assert.equal((await app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers })).json().url, settings.url);
    assert.equal((await app.inject({ method: 'GET', url: pathOf(settings.url) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'HEAD', url: pathOf(settings.url) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: pathOf(settings.url) })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: `${pathOf(settings.url)}/extra` })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/v1/state' })).statusCode, 401);
    const encrypted = JSON.stringify(store.db.prepare('SELECT * FROM records').all());
    assert.ok(!encrypted.includes(token)); assert.ok(!encrypted.includes(config.CALENDAR_SERVICE_TOKEN));
  } finally { await app.close(); store.close(); }
});

test('private links survive restart, rotate immediately, revoke uniformly, and never revive an old token', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'calendar-feed-test-')); const value = fixture(); const key = value.config.CALENDAR_ENCRYPTION_KEY; value.store.close();
  const dbPath = join(directory, 'calendar.sqlite'); let current = setup(new Store(dbPath, key));
  try {
    const original = (await current.app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers: current.headers })).json();
    await current.app.close(); current.store.close(); current = setup(new Store(dbPath, key));
    assert.equal((await current.app.inject({ method: 'GET', url: '/v1/calendar/feed', headers: current.headers })).json().url, original.url);
    const rotated = (await current.app.inject({ method: 'POST', url: '/v1/calendar/feed/rotate', headers: current.headers })).json();
    assert.notEqual(rotated.url, original.url);
    const invalid = await current.app.inject({ method: 'GET', url: `/calendar/feed/${'A'.repeat(43)}.ics` });
    const previous = await current.app.inject({ method: 'GET', url: pathOf(original.url) });
    assert.equal(previous.statusCode, 404); assert.equal(previous.body, invalid.body);
    assert.equal((await current.app.inject({ method: 'GET', url: pathOf(rotated.url) })).statusCode, 200);
    assert.equal((await current.app.inject({ method: 'DELETE', url: '/v1/calendar/feed', headers: current.headers })).json().enabled, false);
    await current.app.close(); current.store.close(); current = setup(new Store(dbPath, key));
    const revoked = await current.app.inject({ method: 'GET', url: pathOf(rotated.url) });
    assert.equal(revoked.statusCode, 404); assert.equal(revoked.body, invalid.body); assert.equal(revoked.headers['cache-control'], 'no-store');
    assert.equal((await current.app.inject({ method: 'POST', url: '/v1/calendar/feed/rotate', headers: current.headers })).statusCode, 409);
    const next = (await current.app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers: current.headers })).json();
    assert.notEqual(next.url, original.url); assert.notEqual(next.url, rotated.url);
    assert.equal((await current.app.inject({ method: 'GET', url: '/calendar/feed/not-a-token.ics' })).body, invalid.body);
  } finally { await current.app.close(); current.store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('missing public origin fails closed and feed settings reject unexpected mutation fields', async () => {
  const { config, store } = fixture(); const { app } = buildApp(config, { store, schedule: false }); const headers = { authorization: `Bearer ${config.CALENDAR_SERVICE_TOKEN}` };
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/v1/calendar/feed', headers })).json().configured, false);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers })).statusCode, 503);
    assert.equal(store.get('calendar_feed_grant'), undefined);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers, payload: { token: 'chosen-token' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'DELETE', url: '/v1/calendar/feed', headers })).statusCode, 200);
  } finally { await app.close(); store.close(); }
});

test('an independent ICS parser sees only saved events and never source evidence, references, credentials, or pending invitations', async () => {
  const { app, store, headers } = setup();
  try {
    store.capture(source('private-source', 'SOURCE_TEXT_SHOULD_NOT_EXPORT'));
    store.put('credentials', 'default', { refresh_token: 'TOKEN_SHOULD_NOT_EXPORT' });
    store.putProposal(proposal({ event: fields({ title: 'INVITATION_SHOULD_NOT_EXPORT' }), evidence: ['EVIDENCE_SHOULD_NOT_EXPORT'] }));
    store.createEvent(fields({ title: 'Confirmed dinner', location: 'A real venue', detail: 'The table is outside.', reference: 'REFERENCE_SHOULD_NOT_EXPORT' }));
    const proposalId = store.putProposal(proposal({ event: fields({ title: 'Approved concert', date: '2026-09-26' }), sourceMessageIds: ['another-private-source'] }))!.id;
    store.confirm(proposalId);
    const link = (await app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers })).json().url;
    const response = await app.inject({ method: 'GET', url: pathOf(link) });
    assert.equal(response.statusCode, 200); assert.equal(response.headers['content-type'], 'text/calendar; charset=utf-8');
    assert.equal(response.headers['referrer-policy'], 'no-referrer'); assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-calendar-omitted-events'], '0');
    const calendar = parse(response.body); assert.equal(calendar.getFirstPropertyValue('version'), '2.0');
    assert.deepEqual(events(response.body).map(event => event.summary).sort(), ['Approved concert', 'Confirmed dinner']);
    for (const privateValue of ['SHOULD_NOT_EXPORT', 'private-source', 'another-private-source', 'Gmail', link]) assert.ok(!response.body.includes(privateValue));
    const dinner = events(response.body).find(event => event.summary === 'Confirmed dinner')!;
    assert.equal(dinner.location, 'A real venue'); assert.equal(dinner.description, 'The table is outside.');
  } finally { await app.close(); store.close(); }
});

test('UIDs and timestamps remain stable across fetches; approved changes increment sequence and cancellation removes the event', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-07T12:00:00Z') });
  const { store } = fixture();
  try {
    const event = store.createEvent(fields()); const initial = renderCalendarFeed(store).body; const first = components(initial)[0]!;
    assert.equal(first.getFirstPropertyValue('sequence'), 0);
    context.mock.timers.setTime(new Date('2026-09-07T13:00:00Z').getTime());
    assert.equal(renderCalendarFeed(store).body, initial);
    const update = store.putProposal(proposal({ action: 'update', targetEventId: event.id, targetRevision: 1, event: fields({ time: '20:30' }) }))!;
    assert.equal(renderCalendarFeed(store).body, initial); store.confirm(update.id);
    const changedBody = renderCalendarFeed(store).body; const changed = components(changedBody)[0]!;
    assert.equal(changed.getFirstPropertyValue('uid'), first.getFirstPropertyValue('uid')); assert.equal(changed.getFirstPropertyValue('sequence'), 1);
    assert.equal(changed.getFirstPropertyValue('created')?.toString(), '2026-09-07T12:00:00Z');
    assert.equal(changed.getFirstPropertyValue('dtstamp')?.toString(), '2026-09-07T13:00:00Z');
    assert.equal(changed.getFirstPropertyValue('last-modified')?.toString(), '2026-09-07T13:00:00Z');
    context.mock.timers.setTime(new Date('2026-09-07T14:00:00Z').getTime()); assert.equal(renderCalendarFeed(store).body, changedBody);
    const cancel = store.putProposal(proposal({ action: 'cancel', targetEventId: event.id, targetRevision: 2 }))!;
    assert.equal(events(renderCalendarFeed(store).body).length, 1); store.confirm(cancel.id); assert.equal(events(renderCalendarFeed(store).body).length, 0);
    const manual = store.createEvent(fields({ title: 'Manual item' })); store.deleteEvent(manual.id, manual.revision); assert.equal(events(renderCalendarFeed(store).body).length, 0);
  } finally { store.close(); }
});

test('legacy events receive one persisted export timestamp and event/metadata writes roll back together', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-07T12:00:00Z') });
  const { store } = fixture();
  try {
    const event = store.createEvent(fields()); store.remove('event_export_metadata', event.id);
    calendarFeedSettings({ CALENDAR_PUBLIC_ORIGIN: origin, CALENDAR_SERVICE_TOKEN: 'unused' }, store);
    assert.equal(store.get('event_export_metadata', event.id), undefined);
    const before = renderCalendarFeed(store).body; context.mock.timers.setTime(new Date('2026-09-08T12:00:00Z').getTime());
    assert.equal(renderCalendarFeed(store).body, before);
    const original = store.eventExportMetadata.bind(store); store.eventExportMetadata = () => { throw new Error('synthetic persistence failure'); };
    assert.throws(() => store.patchEvent(event.id, { title: 'Must roll back' }, event.revision), /persistence/);
    assert.throws(() => store.createEvent(fields({ title: 'Must not survive' })), /persistence/);
    store.eventExportMetadata = original;
    assert.equal(store.events().length, 1); assert.equal(store.events()[0]!.title, event.title);
    assert.equal(store.get<EventExportMetadata>('event_export_metadata', event.id)!.revision, 1);
  } finally { store.close(); }
});

test('timed events become UTC with London seasonal offsets and preserve overnight journeys and both time zones', () => {
  const { store } = fixture();
  try {
    store.createEvent(fields({ title: 'Summer', date: '2026-09-08', time: '19:30' }));
    store.createEvent(fields({ title: 'Winter', date: '2026-12-08', time: '19:30' }));
    store.createEvent(fields({ title: 'Flight', kind: 'travel', date: '2026-09-22', time: '22:00', timeZone: 'America/New_York', endDate: '2026-09-23', endTime: '10:00', endTimeZone: 'Europe/London' }));
    const parsed = events(renderCalendarFeed(store).body);
    assert.equal(parsed.find(event => event.summary === 'Summer')!.startDate.toString(), '2026-09-08T18:30:00Z');
    assert.equal(parsed.find(event => event.summary === 'Winter')!.startDate.toString(), '2026-12-08T19:30:00Z');
    const flight = parsed.find(event => event.summary === 'Flight')!;
    assert.equal(flight.startDate.toString(), '2026-09-23T02:00:00Z'); assert.equal(flight.endDate.toString(), '2026-09-23T09:00:00Z'); assert.equal(flight.duration.toSeconds(), 7 * 3600);
  } finally { store.close(); }
});

test('date-only hotels exclude checkout day, other multiday events include their last day, and neither gains a timed alarm', () => {
  const { store } = fixture();
  try {
    store.createEvent(fields({ title: 'Hotel', kind: 'stay', date: '2026-09-11', endDate: '2026-09-13', time: undefined, reminderMinutes: 30 }));
    store.createEvent(fields({ title: 'Festival', kind: 'social', date: '2026-09-11', endDate: '2026-09-13', time: undefined }));
    store.createEvent(fields({ title: 'Birthday', kind: 'social', date: '2026-09-19', time: undefined }));
    const body = renderCalendarFeed(store).body; const parsed = events(body);
    const hotel = parsed.find(event => event.summary === 'Hotel')!; assert.equal(hotel.startDate.isDate, true); assert.equal(hotel.endDate.toString(), '2026-09-13'); assert.equal(hotel.duration.toSeconds(), 2 * 86400);
    assert.equal(parsed.find(event => event.summary === 'Festival')!.endDate.toString(), '2026-09-14');
    assert.equal(parsed.find(event => event.summary === 'Birthday')!.duration.toSeconds(), 86400);
    assert.equal(components(body).flatMap(event => event.getAllSubcomponents('valarm')).length, 0);
  } finally { store.close(); }
});

test('unknown or equal end times are not replaced by fabricated durations', () => {
  const { store } = fixture();
  try {
    store.createEvent(fields({ title: 'Unknown checkout time', kind: 'stay', endDate: '2026-09-10' }));
    store.createEvent(fields({ title: 'Instant', endTime: '19:30' }));
    const parsed = components(renderCalendarFeed(store).body);
    for (const component of parsed) { assert.equal(component.hasProperty('dtend'), false); assert.equal(component.hasProperty('duration'), false); }
    assert.ok(parsed.map(component => new ICAL.Event(component)).find(event => event.summary === 'Unknown checkout time')!.description.includes('End time has not been provided.'));
  } finally { store.close(); }
});

test('ambiguous and nonexistent default-zone times are omitted with an explicit owner-visible issue; UTC is unambiguous', async () => {
  const { app, config, store, headers } = setup();
  try {
    const autumn = store.createEvent(fields({ title: 'Autumn ambiguous', date: '2026-10-25', time: '01:30' }));
    const spring = store.createEvent(fields({ title: 'Spring missing', date: '2026-03-29', time: '01:30' }));
    store.createEvent(fields({ title: 'Explicit UTC', date: '2026-10-25', time: '01:30', timeZone: 'UTC' }));
    const status = calendarFeedSettings(config, store);
    assert.deepEqual(status.blockedEvents.map(event => event.id).sort(), [autumn.id, spring.id].sort());
    assert.ok(status.blockedEvents.every(event => event.reason.includes('clocks change')));
    const link = (await app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers })).json().url;
    const response = await app.inject({ method: 'GET', url: pathOf(link) });
    assert.equal(response.statusCode, 200); assert.equal(response.headers['x-calendar-omitted-events'], '2');
    assert.deepEqual(events(response.body).map(event => event.summary), ['Explicit UTC']);
    assert.ok(!response.body.includes(autumn.id)); assert.ok(!response.body.includes('Autumn ambiguous'));
  } finally { await app.close(); store.close(); }
});

test('UTF-8 text, line endings, delimiters, and attempted property injection round-trip safely through an independent parser', () => {
  const { store } = fixture();
  try {
    const title = `Dinner, friends; 🍜 ${'É東京'.repeat(25)}\\ terrace\r\nBEGIN:VEVENT\r\nSUMMARY:Injected`;
    const detail = `First line\r\nSecond line\rThird line\n${'💚東京 café; table, outside \\ '.repeat(80)}`;
    const location = 'London; venue, with a \\ sign\r\nATTENDEE:mailto:invalid@example.test';
    store.createEvent(fields({ title, detail, location })); const body = renderCalendarFeed(store).body;
    assert.equal(body.replaceAll('\r\n', '').includes('\n'), false);
    for (const line of body.split('\r\n')) { assert.ok(Buffer.byteLength(line, 'utf8') <= 75); assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(line))); }
    const parsed = components(body); assert.equal(parsed.length, 1); const event = new ICAL.Event(parsed[0]!);
    assert.equal(event.summary, title.replace(/\r\n|\r/g, '\n')); assert.equal(event.description, detail.replace(/\r\n|\r/g, '\n')); assert.equal(event.location, location.replace(/\r\n|\r/g, '\n'));
    assert.equal(parsed[0]!.getAllProperties('attendee').length, 0); assert.equal(parsed[0]!.getAllProperties('summary').length, 1);
  } finally { store.close(); }
});

test('reminders are strictly validated, default to fifteen minutes, support at-start/off, and survive model updates', () => {
  const { store } = fixture();
  try {
    for (const invalid of [-1, 1.5, 10081, '15']) {
      assert.equal(EventFields.safeParse({ ...fields(), reminderMinutes: invalid }).success, false);
      assert.equal(EventPatch.safeParse({ reminderMinutes: invalid }).success, false);
    }
    const defaultEvent = store.createEvent(fields({ title: 'Default reminder' }));
    const off = store.createEvent(fields({ title: 'No reminder', reminderMinutes: null }));
    store.createEvent(fields({ title: 'At start', reminderMinutes: 0 }));
    const custom = store.createEvent(fields({ title: 'Custom', reminderMinutes: 120 }));
    const lookup = () => new Map(components(renderCalendarFeed(store).body).map(event => [event.getFirstPropertyValue('summary'), event.getFirstSubcomponent('valarm')]));
    const alarms = lookup();
    assert.equal((alarms.get('Default reminder')!.getFirstPropertyValue('trigger') as ICAL.Duration).toSeconds(), -900);
    assert.equal(alarms.get('No reminder'), null); assert.equal((alarms.get('At start')!.getFirstPropertyValue('trigger') as ICAL.Duration).toSeconds(), 0);
    assert.equal((alarms.get('Custom')!.getFirstPropertyValue('trigger') as ICAL.Duration).toSeconds(), -7200);
    store.patchEvent(defaultEvent.id, { reminderMinutes: null }, defaultEvent.revision); assert.equal(lookup().get('Default reminder'), null);
    for (const old of [off, custom]) {
      const update = store.putProposal(proposal({ action: 'update', targetEventId: old.id, targetRevision: old.revision, event: fields({ title: old.title, time: '20:00' }) }))!;
      assert.equal(store.confirm(update.id).event!.reminderMinutes, old.reminderMinutes);
    }
    const pending = store.putProposal(proposal({ event: fields({ title: 'Approved with reminder' }) }))!;
    assert.equal(store.confirm(pending.id, { reminderMinutes: 60 }).event!.reminderMinutes, 60);
    const unchanged = fields({ title: 'Existing proposal without a reminder preference' });
    assert.ok(store.putProposal(proposal({ event: unchanged })));
    assert.equal(store.putProposal(proposal({ event: EventFields.parse({ ...unchanged, reminderMinutes: undefined }) })), undefined);
  } finally { store.close(); }
});


test('a pre-existing grant and legacy event keep their URL, UID and encrypted token bytes', async () => {
  const { app, config, store, headers } = setup();
  try {
    const token = 'L'.repeat(43);
    const oldGrant = { token, tokenHash: hash(token), updatedAt: '2026-09-07T12:00:00Z' };
    store.put('calendar_feed_grant', 'default', oldGrant);
    const event = store.createEvent(fields({ title: 'Legacy confirmed plan' }));
    store.put('events', event.id, { ...event, attendance: undefined });
    const grantBytes = () => (store.db.prepare("SELECT payload FROM records WHERE bucket='calendar_feed_grant'").get() as { payload: string }).payload;
    const before = grantBytes();
    const settings = (await app.inject({ method: 'GET', url: '/v1/calendar/feed', headers })).json();
    assert.equal(settings.url, `${origin}/calendar/feed/${token}.ics`);
    assert.equal(settings.updatedAt, oldGrant.updatedAt);
    assert.deepEqual(store.get('calendar_feed_grant'), oldGrant); assert.equal(grantBytes(), before);
    const exported = components((await app.inject({ method: 'GET', url: pathOf(settings.url) })).body);
    assert.equal(exported.length, 1); assert.equal(exported[0]!.getFirstPropertyValue('uid'), `${hash(event.id)}@personal-calendar`);
    assert.equal(exported[0]!.getFirstPropertyValue('status'), 'CONFIRMED');
    assert.equal(exported[0]!.getFirstPropertyValue('transp'), 'OPAQUE');
    assert.equal(calendarFeedSettings(config, store).url, settings.url); assert.equal(grantBytes(), before);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers })).json().url, settings.url);
    assert.equal(grantBytes(), before);
    assert.equal('invitationUrl' in settings, false);
    assert.equal((await app.inject({ method: 'GET', url: `/calendar/feed/${token}/invitations.ics` })).statusCode, 401);
  } finally { await app.close(); store.close(); }
});

test('one private feed contains confirmed plans and clearly labelled tentative invitations without alarms', async () => {
  const { app, store, headers } = setup();
  try {
    const confirmed = store.createEvent(fields({ title: 'Confirmed dinner', attendance: 'confirmed' }));
    const invitation = store.createEvent(fields({ title: 'Birthday, drinks; friends', attendance: 'invited', reminderMinutes: 120 }));
    store.createEvent(fields({ title: 'Without reminder preference', attendance: 'invited' }));
    store.createEvent(fields({ title: 'At start reminder', attendance: 'invited', reminderMinutes: 0 }));
    store.createEvent(fields({ title: 'Date-only invitation', attendance: 'invited', time: undefined }));
    store.putProposal(proposal({ event: fields({ title: 'UNRESOLVED_SHOULD_NOT_EXPORT' }), evidence: ['EVIDENCE_SHOULD_NOT_EXPORT'] }));
    const settings = (await app.inject({ method: 'POST', url: '/v1/calendar/feed/enable', headers })).json();
    const body = (await app.inject({ method: 'GET', url: pathOf(settings.url) })).body;
    const calendar = parse(body); const exported = calendar.getAllSubcomponents('vevent');
    assert.equal(exported.length, 5);
    const booked = exported.find(component => component.getFirstPropertyValue('uid') === `${hash(confirmed.id)}@personal-calendar`)!;
    assert.equal(booked.getFirstPropertyValue('summary'), 'Confirmed dinner');
    assert.equal(booked.getFirstPropertyValue('status'), 'CONFIRMED'); assert.equal(booked.getFirstPropertyValue('transp'), 'OPAQUE');
    assert.equal(booked.getAllSubcomponents('valarm').length, 1);
    const invitations = exported.filter(component => component !== booked); assert.equal(invitations.length, 4);
    for (const component of invitations) {
      assert.equal(component.getFirstPropertyValue('status'), 'TENTATIVE');
      assert.equal(component.getFirstPropertyValue('transp'), 'TRANSPARENT');
      assert.match(new ICAL.Event(component).summary, /^INVITATION: /);
      assert.equal(component.getAllSubcomponents('valarm').length, 0);
      assert.equal(component.hasProperty('organizer'), false); assert.equal(component.hasProperty('attendee'), false);
    }
    const birthday = invitations.find(component => component.getFirstPropertyValue('uid') === `${hash(invitation.id)}@personal-calendar`)!;
    assert.equal(birthday.getFirstPropertyValue('summary'), 'INVITATION: Birthday, drinks; friends');
    assert.ok(!body.includes('SHOULD_NOT_EXPORT'));
    assert.equal(calendar.hasProperty('color'), false); assert.equal(calendar.hasProperty('x-apple-calendar-color'), false);
    const rotated = (await app.inject({ method: 'POST', url: '/v1/calendar/feed/rotate', headers })).json();
    assert.equal((await app.inject({ method: 'GET', url: pathOf(settings.url) })).statusCode, 404);
    assert.equal(components((await app.inject({ method: 'GET', url: pathOf(rotated.url) })).body).length, 5);
    await app.inject({ method: 'DELETE', url: '/v1/calendar/feed', headers });
    assert.equal((await app.inject({ method: 'GET', url: pathOf(rotated.url) })).statusCode, 404);
  } finally { await app.close(); store.close(); }
});

test('accepting an invitation updates the same UID, removes its label and restores its saved reminder preference', () => {
  const { store } = fixture();
  try {
    const invitation = store.createEvent(fields({ title: 'Birthday drinks', attendance: 'invited', reminderMinutes: 60 }));
    const old = components(renderCalendarFeed(store).body)[0]!;
    assert.equal(old.getFirstPropertyValue('summary'), 'INVITATION: Birthday drinks');
    const accepted = store.patchEvent(invitation.id, { attendance: 'confirmed' }, invitation.revision);
    const exported = components(renderCalendarFeed(store).body); assert.equal(exported.length, 1);
    const current = exported[0]!;
    assert.equal(current.getFirstPropertyValue('uid'), old.getFirstPropertyValue('uid'));
    assert.equal(current.getFirstPropertyValue('sequence'), 1);
    assert.equal(current.getFirstPropertyValue('created')?.toString(), old.getFirstPropertyValue('created')?.toString());
    assert.equal(current.getFirstPropertyValue('summary'), 'Birthday drinks');
    assert.equal(current.getFirstPropertyValue('status'), 'CONFIRMED'); assert.equal(current.getFirstPropertyValue('transp'), 'OPAQUE');
    assert.equal((current.getFirstSubcomponent('valarm')!.getFirstPropertyValue('trigger') as ICAL.Duration).toSeconds(), -3600);
    assert.equal(store.events()[0]!.title, 'Birthday drinks');
    store.deleteEvent(accepted.id, accepted.revision);
    assert.equal(components(renderCalendarFeed(store).body).length, 0);
  } finally { store.close(); }
});

test('legacy prefixed titles are labelled once and lose the presentation label on confirmation without changing stored titles', () => {
  const { store } = fixture();
  try {
    const invitation = store.createEvent(fields({ title: 'Ordinary canonical title', attendance: 'invited' }));
    const legacyTitle = 'Invitation: INVITATION: Birthday drinks';
    store.put('events', invitation.id, { ...invitation, title: legacyTitle });
    assert.equal(components(renderCalendarFeed(store).body)[0]!.getFirstPropertyValue('summary'), 'INVITATION: Birthday drinks');
    assert.equal(store.events()[0]!.title, legacyTitle);
    store.patchEvent(invitation.id, { attendance: 'confirmed' }, invitation.revision);
    assert.equal(components(renderCalendarFeed(store).body)[0]!.getFirstPropertyValue('summary'), 'Birthday drinks');
    store.put('events', invitation.id, { ...invitation, title: 'INVITATION: Invitation:' });
    assert.equal(components(renderCalendarFeed(store).body)[0]!.getFirstPropertyValue('summary'), 'INVITATION: Untitled plan');
  } finally { store.close(); }
});
