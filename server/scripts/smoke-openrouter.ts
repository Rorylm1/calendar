import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readConfig } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { ModelInterpreter } from '../src/interpreter.ts';
import type { SourceMessage } from '../src/domain.ts';

// Explicit opt-in: this script makes two billable calls using invented content only.
if (process.env.RUN_LIVE_MODEL_SMOKE !== 'yes') throw new Error('Set RUN_LIVE_MODEL_SMOKE=yes only when live API use is authorized.');
const config = readConfig(); config.GMAIL_ALLOWED_EMAIL = 'owner@example.test'; config.AI_MONTHLY_BUDGET_USD = 0.05;
const store = new Store(':memory:', config.CALENDAR_ENCRYPTION_KEY);
try {
  const model = new ModelInterpreter(config, store);
  const source: SourceMessage = { id: 'synthetic-smoke-reservation', threadId: 'synthetic-smoke-thread', from: 'bookings@example.test', to: 'owner@example.test', subject: 'Synthetic restaurant booking', receivedAt: '2026-09-07T12:00:00Z', sentByOwner: false, text: 'Your table for two at Example Restaurant is confirmed for 18 September 2026 at 19:30, Europe/London. Booking reference SYNTHETIC-123.', context: [], unsupportedAttachments: [] };
  const triage = await model.triage(source); assert.notEqual(triage.decision, 'irrelevant');
  const extraction = await model.extract(source, [], []); assert.equal(extraction.proposals.length, 1);
  const event = extraction.proposals[0]!.event; assert.equal(event.date, '2026-09-18'); assert.equal(event.time, '19:30'); assert.equal(event.reference, 'SYNTHETIC-123');
  const usage = store.all('model_usage');
  const report = { checkedAt: new Date().toISOString(), endpoint: 'https://openrouter.ai/api/v1/responses', models: { triage: config.AI_TRIAGE_MODEL, extraction: config.AI_EXTRACTION_MODEL }, privacy: { store: false, requireParameters: true, dataCollection: 'deny' }, syntheticOnly: true, gmailAccessed: false, passed: true, totalCostUsd: store.spend(), usage };
  mkdirSync('smoke', { recursive: true }); writeFileSync('smoke/openrouter-smoke.json', `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify(report));
} catch (error) {
  // Never print provider errors, request headers, or credentials.
  console.error(JSON.stringify({ passed: false, errorType: error instanceof Error ? error.name : 'Unknown', status: error && typeof error === 'object' && 'status' in error ? error.status : undefined, reservedOrSpentUsd: store.spend() })); process.exitCode = 1;
} finally { store.close(); }
