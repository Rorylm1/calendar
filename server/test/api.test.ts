import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { fixture, fields, proposal } from './helpers.ts';

test('API requires service authentication and returns no credentials', async () => {
  const { config, store } = fixture(); store.put('credentials', 'default', { refresh_token: 'never-expose-this-token' });
  const { app } = buildApp(config, { store, schedule: false });
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200); assert.equal((await app.inject({ method: 'GET', url: '/v1/state' })).statusCode, 401);
  const state = await app.inject({ method: 'GET', url: '/v1/state', headers: { authorization: `Bearer ${config.CALENDAR_SERVICE_TOKEN}` } });
  assert.equal(state.statusCode, 200); assert.ok(!state.body.includes('never-expose')); assert.deepEqual(state.json().events, []); assert.equal(state.headers['cache-control'], 'no-store'); await app.close(); store.close();
});
test('API creates, edits, protects revisions, and deletes manual events', async () => {
  const { config, store } = fixture(); const { app } = buildApp(config, { store, schedule: false }); const headers = { authorization: `Bearer ${config.CALENDAR_SERVICE_TOKEN}` };
  const created = await app.inject({ method: 'POST', url: '/v1/events', headers, payload: fields() }); assert.equal(created.statusCode, 201); const event = created.json().event;
  const edited = await app.inject({ method: 'PATCH', url: `/v1/events/${event.id}`, headers, payload: { event: { time: null }, expectedRevision: 1 } }); assert.equal(edited.statusCode, 200); assert.equal(edited.json().event.time, undefined);
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/events/${event.id}`, headers, payload: { expectedRevision: 1 } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/events/${event.id}`, headers, payload: { expectedRevision: 2 } })).statusCode, 200); assert.equal(store.events().length, 0); await app.close(); store.close();
});
test('API validates real dates and leaves incomplete suggestions pending', async () => {
  const { config, store } = fixture(); const { app } = buildApp(config, { store, schedule: false }); const headers = { authorization: `Bearer ${config.CALENDAR_SERVICE_TOKEN}` };
  assert.equal((await app.inject({ method: 'POST', url: '/v1/events', headers, payload: fields({ date: '2026-02-30' }) })).statusCode, 400);
  const pending = store.putProposal(proposal({ event: fields({ date: undefined }) }))!;
  assert.equal((await app.inject({ method: 'POST', url: `/v1/proposals/${pending.id}/confirm`, headers, payload: {} })).statusCode, 400);
  const approved = await app.inject({ method: 'POST', url: `/v1/proposals/${pending.id}/confirm`, headers, payload: { event: { date: '2026-09-08' } } }); assert.equal(approved.statusCode, 200);
  const state = (await app.inject({ method: 'GET', url: '/v1/state', headers })).json(); assert.equal(state.proposals.length, 0); assert.equal(state.events.length, 1); await app.close(); store.close();
});
test('pending migration requires service authentication, defaults to a rollback preview, and exposes counts only', async () => {
  const { config, store } = fixture(); store.putProposal(proposal({ attendance: 'invited' }));
  const { app } = buildApp(config, { store, schedule: false }); const headers = { authorization: `Bearer ${config.CALENDAR_SERVICE_TOKEN}` };
  assert.equal((await app.inject({ method: 'POST', url: '/v1/proposals/apply-pending', payload: { dryRun: false } })).statusCode, 401);
  const preview = await app.inject({ method: 'POST', url: '/v1/proposals/apply-pending', headers, payload: {} });
  assert.equal(preview.statusCode, 200); assert.equal(preview.json().created, 1); assert.equal(store.events().length, 0); assert.ok(!preview.body.includes('Luca'));
  assert.equal((await app.inject({ method: 'POST', url: '/v1/proposals/apply-pending', headers, payload: { unexpected: true } })).statusCode, 400);
  const applied = await app.inject({ method: 'POST', url: '/v1/proposals/apply-pending', headers, payload: { dryRun: false } });
  assert.equal(applied.statusCode, 200); assert.equal(store.events()[0]!.attendance, 'invited');
  const state = (await app.inject({ method: 'GET', url: '/v1/state', headers })).json(); assert.equal(state.events.length, 1); assert.equal(state.proposals.length, 0);
  const event = state.events[0];
  const accepted = await app.inject({ method: 'PATCH', url: `/v1/events/${event.id}`, headers, payload: { event: { attendance: 'confirmed' }, expectedRevision: event.revision } });
  assert.equal(accepted.statusCode, 200); assert.equal(accepted.json().event.id, event.id); assert.equal(accepted.json().event.attendance, 'confirmed');
  await app.close(); store.close();
});
