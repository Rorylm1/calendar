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
