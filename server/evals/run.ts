import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readConfig } from '../src/config.ts';
import { ModelInterpreter, type Interpreter } from '../src/interpreter.ts';
import { ProcessingPaused } from '../src/errors.ts';
import { Store } from '../src/store.ts';
import { corpus, syntheticOwner } from './corpus.ts';
import { runEvaluation, validateCorpus } from './evaluate.ts';
import { MAX_EVALUATION_USD, reserveEvaluationBudget } from './budget.ts';

class EvaluationStore extends Store {
  // The run limit must not reset if an evaluation crosses a UTC month boundary.
  override spend(): number { return Number((this.db.prepare('SELECT COALESCE(SUM(cost),0) amount FROM usage').get() as { amount: number }).amount); }
}

export async function main(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  const { values } = parseArgs({ args, options: { live: { type: 'boolean', default: false }, 'budget-ledger': { type: 'string' }, 'max-usd': { type: 'string', default: String(MAX_EVALUATION_USD) }, limit: { type: 'string', default: '50' }, output: { type: 'string' } }, allowPositionals: false });
  const cases = validateCorpus(); const count = Number(values.limit); const maximumUsd = Number(values['max-usd']);
  if (!Number.isSafeInteger(count) || count < 1 || count > cases.length) throw new Error('Use an evaluation limit from 1 to 50.');
  if (!Number.isFinite(maximumUsd) || maximumUsd <= 0 || maximumUsd > MAX_EVALUATION_USD) throw new Error('Evaluation budget must be above zero and at most $0.50.');
  const selected = cases.slice(0, count);
  let report: unknown;
  if (!values.live) {
    report = { mode: 'offline-validation', synthetic: true, corpusVersion: 1, labelledCases: corpus.length, selectedCases: selected.length,
      passLabels: cases.filter(item => item.expected.triage === 'pass').length, rejectLabels: cases.filter(item => item.expected.triage === 'reject').length,
      tags: [...new Set(cases.flatMap(item => item.tags))].sort(), modelCalls: 0, costUsd: 0, measuredQuality: null,
      note: 'Corpus structure is valid. Model quality has not been measured. Live evaluation requires explicit --live and --budget-ledger flags.' };
  } else {
    if (!values['budget-ledger']) throw new Error('Live evaluation requires an explicit --budget-ledger path.');
    if (!env.OPENROUTER_API_KEY) throw new Error('Live evaluation requires OPENROUTER_API_KEY.');
    // Copy only model settings. Real owner, Google credentials, event database,
    // service tokens, webhook secrets and notification keys are never used.
    const modelEnvironment: NodeJS.ProcessEnv = {};
    for (const name of ['OPENROUTER_API_KEY', 'AI_TRIAGE_MODEL', 'AI_EXTRACTION_MODEL', 'AI_MONTHLY_BUDGET_USD', 'AI_TRIAGE_INPUT_USD', 'AI_TRIAGE_OUTPUT_USD', 'AI_EXTRACTION_INPUT_USD', 'AI_EXTRACTION_OUTPUT_USD']) if (env[name] !== undefined) modelEnvironment[name] = env[name];
    const config = readConfig({ ...modelEnvironment, CALENDAR_SERVICE_TOKEN: randomBytes(32).toString('hex'), CALENDAR_ENCRYPTION_KEY: randomBytes(32).toString('hex'), CALENDAR_DB_PATH: ':memory:', GMAIL_ALLOWED_EMAIL: syntheticOwner });
    const lease = reserveEvaluationBudget(values['budget-ledger'], config.AI_MONTHLY_BUDGET_USD, maximumUsd);
    const store = new EvaluationStore(':memory:', config.CALENDAR_ENCRYPTION_KEY);
    try {
      config.AI_MONTHLY_BUDGET_USD = lease.limitUsd;
      const model = new ModelInterpreter(config, store);
      const checkMonth = () => { if (new Date().toISOString().slice(0, 7) !== lease.month) throw new ProcessingPaused('paused_budget'); };
      const interpreter: Interpreter = {
        triage: async (...args) => { checkMonth(); return model.triage(...args); },
        extract: async (...args) => { checkMonth(); return model.extract(...args); },
      };
      const result = await runEvaluation(selected, interpreter, store);
      const usage = store.all<{ model: string; costUsd: number; costSource: string; inputTokens: number; outputTokens: number }>('model_usage');
      const measuredCostUsd = usage.reduce((sum, call) => sum + call.costUsd, 0); const accountedCostUsd = store.spend();
      report = { mode: 'live-synthetic-evaluation', synthetic: true, corpusVersion: 1, ranAt: new Date().toISOString(),
        models: { triage: config.AI_TRIAGE_MODEL, extraction: config.AI_EXTRACTION_MODEL },
        budget: { maximumUsd: lease.limitUsd, measuredCostUsd, accountedCostUsd, uncertainReservedUsd: Math.max(0, accountedCostUsd - measuredCostUsd), withinLimit: accountedCostUsd <= lease.limitUsd, reservationId: lease.id },
        completedModelCalls: usage.length, usage, ...result,
        limitations: 'Synthetic coverage only. Unattempted and budget-limited extraction cases are not model-quality results. No real Gmail, WhatsApp, calendar events or notification deliveries are exercised.' };
    } finally {
      try { lease.settle(store.spend()); } finally { lease.close(); store.close(); }
    }
  }
  if (values.output) { const path = resolve(values.output); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch(() => { process.stderr.write('Evaluation did not run successfully. Check the explicit flags, configuration, and existing budget ledger. No raw provider errors are printed.\n'); process.exitCode = 1; });
}
