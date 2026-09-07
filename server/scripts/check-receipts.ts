import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readConfig } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { ModelInterpreter } from '../src/interpreter.ts';
import type { SourceMessage } from '../src/domain.ts';

// Six billable model calls on invented messages, never a real mailbox or database.
if (process.env.RUN_LIVE_MODEL_SMOKE !== 'yes') throw new Error('Live model checks require explicit opt-in.');
const config = readConfig();
config.GMAIL_ALLOWED_EMAIL = 'owner@example.test';
config.AI_MONTHLY_BUDGET_USD = 0.2;
const store = new Store(':memory:', config.CALENDAR_ENCRYPTION_KEY);
const cases = [
  { id: 'completed-pub-purchase', subject: 'Your payment receipt', text: 'Example Pub. Receipt for your visit on 7 September 2026 at 18:42. Two pints: GBP 13.80. Paid by card: GBP 13.80. Balance due: GBP 0.00. Thank you for visiting.', date: null },
  { id: 'reservation-deposit', subject: 'Receipt for your restaurant deposit', text: 'Payment received on 7 September 2026: GBP 20.00 deposit. Your table for two at Example Restaurant is confirmed for 25 September 2026 at 19:30 Europe/London. Booking reference TEST-TABLE.', date: '2026-09-25' },
  { id: 'train-ticket-receipt', subject: 'Receipt and your train ticket', text: 'Payment receipt, paid 7 September 2026. Your train ticket is confirmed: London Euston to Manchester Piccadilly, departing 28 September 2026 at 09:00 Europe/London, arriving 11:10. Ticket reference TEST-TRAIN.', date: '2026-09-28' },
];

try {
  const model = new ModelInterpreter(config, store);
  const results = await Promise.all(cases.map(async item => {
    const email: SourceMessage = { id: item.id, threadId: item.id, from: 'receipts@example.test', to: 'owner@example.test', subject: item.subject, text: item.text, receivedAt: '2026-09-07T19:00:00Z', sentByOwner: false, context: [], unsupportedAttachments: [] };
    const triage = await model.triage(email);
    // Exercise extraction even for an irrelevant receipt: cached older triage must also be safe.
    const result = await model.extract(email, [], []);
    if (item.date === null) {
      assert.equal(triage.decision, 'irrelevant', item.id);
      assert.equal(result.proposals.length, 0, item.id);
    } else {
      assert.notEqual(triage.decision, 'irrelevant', item.id);
      assert.equal(result.proposals.length, 1, item.id);
      assert.equal(result.proposals[0]!.event.date, item.date, item.id);
    }
    return { case: item.id, triage: triage.decision, proposals: result.proposals.length, serviceDateCorrect: true };
  }));
  const report = { checkedAt: new Date().toISOString(), syntheticOnly: true, passed: true, cases: results, totalCostUsd: store.spend() };
  mkdirSync('smoke', { recursive: true });
  writeFileSync('smoke/receipt-check.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify({ passed: false, errorType: error instanceof Error ? error.name : 'Unknown', reservedOrSpentUsd: store.spend() }));
  process.exitCode = 1;
} finally { store.close(); }
