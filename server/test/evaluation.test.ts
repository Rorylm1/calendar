import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { corpus, type ExpectedProposal } from '../evals/corpus.ts';
import { runEvaluation, scoreProposals, validateCorpus } from '../evals/evaluate.ts';
import { reserveEvaluationBudget } from '../evals/budget.ts';
import { main } from '../evals/run.ts';
import { fixture } from './helpers.ts';
import type { ExtractionResult, Interpreter } from '../src/interpreter.ts';

function actual(expected: ExpectedProposal): ExtractionResult['proposals'][number] {
  return { action: expected.action, targetEventId: expected.targetEventId, attendance: expected.attendance,
    event: { title: 'Synthetic calendar event', date: null, time: null, endDate: null, endTime: null, timeZone: null, endTimeZone: null, location: '', detail: '', reference: null, ...expected.fields } as ExtractionResult['proposals'][number]['event'],
    reason: 'Synthetic scorer fixture, not a model evaluation.', evidence: ['Synthetic evidence'], unresolvedFields: expected.missingContext };
}
function ledger(spent = 0) {
  const directory = mkdtempSync(join(tmpdir(), 'calendar-evaluation-')); const path = join(directory, 'budget.sqlite'); const db = new DatabaseSync(path);
  db.exec('CREATE TABLE usage(id TEXT PRIMARY KEY,month TEXT NOT NULL,cost REAL NOT NULL,status TEXT NOT NULL); CREATE TABLE sources(id TEXT PRIMARY KEY,status TEXT NOT NULL); CREATE TABLE records(bucket TEXT,id TEXT,payload TEXT);');
  db.prepare('INSERT INTO usage VALUES(?,?,?,?)').run('existing-synthetic-spend', new Date().toISOString().slice(0, 7), spent, 'settled');
  db.prepare('INSERT INTO sources VALUES(?,?)').run('synthetic-source', 'processing');
  db.prepare('INSERT INTO records VALUES(?,?,?)').run('events', 'synthetic-event', 'unchanged-private-placeholder');
  return { path, db, cleanup() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('the 50-case synthetic corpus covers booking types, receipt distinctions, attendance, change and duplicate scenarios', () => {
  const cases = validateCorpus(); assert.equal(cases.length, 50); assert.equal(cases.filter(item => item.expected.triage === 'reject').length, 9);
  const tags = new Set(cases.flatMap(item => item.tags));
  for (const tag of ['restaurant', 'hotel', 'flight', 'train', 'ticket', 'appointment', 'invitation', 'acceptance', 'refusal', 'ambiguity', 'advert', 'receipt', 'future-service', 'past-purchase', 'amendment', 'cancellation', 'duplicate', 'short-image-ad', 'relative-date', 'reply-context', 'untrusted-content']) assert.ok(tags.has(tag), tag);
  for (const item of cases) {
    assert.equal(item.synthetic, true); assert.equal(item.source.receivedAt, item.referenceTime); assert.equal(item.referenceTimeZone, 'Europe/London');
    assert.ok(item.source.from.endsWith('@example.test')); assert.ok(item.source.to.endsWith('@example.test'));
    assert.notEqual(item.source.subject, item.label); assert.match(item.source.id, /^eval-\d{3}$/); assert.match(item.source.threadId, /^eval-thread-\d{3}$/);
    assert.ok(!JSON.stringify(item.source).includes(item.expected.rationale));
    if (item.tags.includes('relative-date')) assert.match(item.referenceTime, /[+-]\d\d:\d\d$/);
  }
  const corrupt = structuredClone(cases); corrupt[1]!.id = corrupt[0]!.id; assert.throws(() => validateCorpus(corrupt), /unique/);
  const unlabelled = structuredClone(cases); unlabelled[0]!.synthetic = false as true; assert.throws(() => validateCorpus(unlabelled));
  const foreign = structuredClone(cases); foreign[0]!.source.from = 'someone@real-domain.invalid'; assert.throws(() => validateCorpus(foreign));
  const leaked = structuredClone(cases); leaked[0]!.source.subject = leaked[0]!.label; assert.throws(() => validateCorpus(leaked), /leak/);
});

test('offline validation makes no model calls, opens no ledger, and reports quality as unmeasured', async () => {
  const originalFetch = globalThis.fetch; let calls = 0; const directory = mkdtempSync(join(tmpdir(), 'calendar-evaluation-offline-')); const missing = join(directory, 'must-not-exist.sqlite');
  globalThis.fetch = async () => { calls++; throw new Error('Network must not be used offline'); };
  try {
    const report = await main(['--budget-ledger', missing], { CALENDAR_DB_PATH: missing, OPENROUTER_API_KEY: 'unused-synthetic-secret' }) as { mode: string; modelCalls: number; measuredQuality: null; labelledCases: number };
    assert.equal(report.mode, 'offline-validation'); assert.equal(report.labelledCases, 50); assert.equal(report.measuredQuality, null); assert.equal(report.modelCalls, 0); assert.equal(calls, 0); assert.equal(existsSync(missing), false);
    await assert.rejects(main(['--live'], {}), /budget-ledger/); await assert.rejects(main(['--max-usd', '0.51']), /at most/);
    await assert.rejects(main(['--limit', '51']), /1 to 50/);
  } finally { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); }
});

test('scoring matches reversed flight legs and separately detects wrong fields, extra proposals and missing context', () => {
  const itinerary = corpus.find(item => item.id === 'flight-two-legs')!; const expected = itinerary.expected.proposals;
  const reversed = expected.map(actual).reverse(); const perfect = scoreProposals(expected, reversed); assert.equal(perfect.fullyCorrect, 2); assert.equal(perfect.correctFields, perfect.checkedFields);
  reversed[0]!.event.date = '2030-01-01'; const wrong = scoreProposals(expected, reversed); assert.equal(wrong.fullyCorrect, 1); assert.ok(wrong.pairs.flatMap(pair => pair.mismatches).some(item => item.field === 'date'));
  const extra = scoreProposals(expected, [...expected.map(actual), actual(expected[0]!)]); assert.equal(extra.extraProposalIndexes.length, 1); assert.equal(extra.actualCount, 3);
  const missing = corpus.find(item => item.id === 'social-tentative-without-date')!.expected.proposals;
  const missingOutput = missing.map(actual); missingOutput[0]!.unresolvedFields = []; assert.equal(scoreProposals(missing, missingOutput).fullyCorrect, 0);
  const dup = scoreProposals([], [actual(expected[0]!)]); assert.equal(dup.fullyCorrect, 0); assert.deepEqual(dup.extraProposalIndexes, [0]);
});

test('triage precision and recall include false passes and missed bookings without pretending skipped extraction was measured', async () => {
  const { store } = fixture(); const selected = [corpus[0]!, corpus.find(item => item.id === 'restaurant-past-receipt')!]; let extractions = 0;
  const interpreter: Interpreter = { triage: async message => ({ decision: message.id === selected[0]!.source.id ? 'irrelevant' : 'relevant', reason: 'Deliberately wrong synthetic classifier.' }), extract: async () => { extractions++; return { proposals: [] }; } };
  try {
    const result = await runEvaluation(selected, interpreter, store); assert.equal(extractions, 1);
    assert.equal(result.summary.triage.falseNegative, 1); assert.equal(result.summary.triage.falsePositive, 1); assert.equal(result.summary.triage.precision, 0); assert.equal(result.summary.triage.recall, 0);
    assert.deepEqual(result.summary.triage.missedCaseIds, [selected[0]!.id]); assert.equal(result.summary.extraction.recall, 0);
    assert.equal(store.events().length, 0); assert.equal(store.proposals().length, 0);
  } finally { store.close(); }
});

test('budget reservations use the lower remaining allowance, exclude simultaneous spending, and never recover or read calendar sources', () => {
  const value = ledger(4.7);
  try {
    const lease = reserveEvaluationBudget(value.path, 5); assert.ok(Math.abs(lease.limitUsd - 0.3) < 1e-9);
    assert.throws(() => reserveEvaluationBudget(value.path, 5), /No monthly budget/);
    assert.equal((value.db.prepare('SELECT status FROM sources').get() as { status: string }).status, 'processing');
    assert.equal((value.db.prepare('SELECT payload FROM records').get() as { payload: string }).payload, 'unchanged-private-placeholder');
    lease.settle(0.04); lease.close();
    assert.ok(Math.abs((value.db.prepare('SELECT SUM(cost) cost FROM usage').get() as { cost: number }).cost - 4.74) < 1e-9);
    const next = reserveEvaluationBudget(value.path, 5, 0.1); assert.equal(next.limitUsd, 0.1); next.close();
    assert.equal((value.db.prepare("SELECT COUNT(*) n FROM usage WHERE status='reserved'").get() as { n: number }).n, 1);
    assert.throws(() => reserveEvaluationBudget(value.path, 5, 0.51), /Invalid evaluation budget/);
  } finally { value.cleanup(); }
});

test('opt-in live path uses only mocked synthetic OpenRouter data, isolated records, and settles actual accounted cost', async () => {
  const value = ledger(); const originalFetch = globalThis.fetch; const calls: { url: string; input: string }[] = [];
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body)); calls.push({ url: String(url), input: request.input });
    const output = request.model.includes('lite') ? { decision: 'relevant', reason: 'Synthetic confirmation.' } : { proposals: corpus[0]!.expected.proposals.map(actual) };
    return Response.json({ id: `synthetic-response-${calls.length}`, object: 'response', created_at: 0, status: 'completed', model: request.model,
      output: [{ id: 'synthetic-message', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', annotations: [], text: JSON.stringify(output) }] }], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200, cost: 0.001 } });
  };
  try {
    const result = await main(['--live', '--budget-ledger', value.path, '--limit', '1'], { OPENROUTER_API_KEY: 'synthetic-key-only', GMAIL_ALLOWED_EMAIL: 'private-owner@unrelated.invalid', CALENDAR_DB_PATH: '/must-not-open', GOOGLE_CLIENT_SECRET: 'must-not-use', AI_MONTHLY_BUDGET_USD: '5' }) as { completedModelCalls: number; budget: { measuredCostUsd: number; accountedCostUsd: number; maximumUsd: number }; summary: { completedCases: number } };
    assert.equal(calls.length, 2); assert.ok(calls.every(call => call.url === 'https://openrouter.ai/api/v1/responses'));
    assert.ok(calls.every(call => call.input.includes('owner@example.test') && !call.input.includes('private-owner') && !call.input.includes('must-not-use')));
    assert.equal(result.completedModelCalls, 2); assert.equal(result.summary.completedCases, 1); assert.equal(result.budget.maximumUsd, 0.5); assert.equal(result.budget.measuredCostUsd, 0.002); assert.equal(result.budget.accountedCostUsd, 0.002);
    assert.equal((value.db.prepare('SELECT SUM(cost) cost FROM usage').get() as { cost: number }).cost, 0.002);
    assert.equal((value.db.prepare('SELECT COUNT(*) n FROM records').get() as { n: number }).n, 1); assert.equal((value.db.prepare('SELECT status FROM sources').get() as { status: string }).status, 'processing');
  } finally { globalThis.fetch = originalFetch; value.cleanup(); }
});

test('insufficient remaining budget stops before any paid request and provider failures keep a conservative accounted reservation', async () => {
  const value = ledger(4.999); const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Synthetic uncertain request outcome'); };
  try {
    const limited = await main(['--live', '--budget-ledger', value.path, '--limit', '1'], { OPENROUTER_API_KEY: 'synthetic-key-only', AI_MONTHLY_BUDGET_USD: '5' }) as { results: { status: string }[]; budget: { accountedCostUsd: number } };
    assert.equal(calls, 0); assert.equal(limited.results[0]!.status, 'budget_limited'); assert.equal(limited.budget.accountedCostUsd, 0);
    value.db.prepare('UPDATE usage SET cost=0').run();
    const failed = await main(['--live', '--budget-ledger', value.path, '--limit', '2'], { OPENROUTER_API_KEY: 'synthetic-key-only', AI_MONTHLY_BUDGET_USD: '5' }) as { results: { status: string; error: string }[]; budget: { accountedCostUsd: number; measuredCostUsd: number } };
    assert.equal(calls, 1); assert.equal(failed.results.length, 1); assert.equal(failed.results[0]!.error, 'provider_error'); assert.equal(failed.budget.measuredCostUsd, 0); assert.ok(failed.budget.accountedCostUsd > 0); assert.ok(failed.budget.accountedCostUsd <= 0.5);
    assert.equal((value.db.prepare('SELECT SUM(cost) cost FROM usage').get() as { cost: number }).cost, failed.budget.accountedCostUsd);
  } finally { globalThis.fetch = originalFetch; value.cleanup(); }
});
