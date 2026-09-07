import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const MAX_EVALUATION_USD = 0.50;
export type BudgetLease = { id: string; month: string; limitUsd: number; settle: (accountedCostUsd: number) => void; close: () => void };

// This deliberately does NOT construct Store: its startup recovery mutates
// source processing states. Only the existing usage table is accessed here.
export function reserveEvaluationBudget(path: string, monthlyBudgetUsd: number, maximumUsd = MAX_EVALUATION_USD, now = new Date()): BudgetLease {
  if (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0 || !Number.isFinite(maximumUsd) || maximumUsd <= 0 || maximumUsd > MAX_EVALUATION_USD) throw new Error('Invalid evaluation budget.');
  const db = new DatabaseSync(realpathSync(path)); let reserved = false;
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='usage'").get()) throw new Error('The explicit budget ledger must already contain the calendar usage table.');
    const id = `eval-${randomUUID()}`; const month = now.toISOString().slice(0, 7);
    db.exec('BEGIN IMMEDIATE');
    const spent = Number((db.prepare('SELECT COALESCE(SUM(cost),0) cost FROM usage WHERE month=?').get(month) as { cost: number }).cost);
    const limitUsd = Math.max(0, Math.min(maximumUsd, monthlyBudgetUsd - spent));
    if (!Number.isFinite(limitUsd) || limitUsd <= 0) throw new Error('No monthly budget remains for evaluation.');
    db.prepare('INSERT INTO usage(id,month,cost,status) VALUES(?,?,?,?)').run(id, month, limitUsd, 'reserved');
    db.exec('COMMIT'); reserved = true; let settled = false;
    return { id, month, limitUsd,
      settle(accountedCostUsd: number) {
        if (settled) throw new Error('This evaluation reservation has already been settled.');
        if (!Number.isFinite(accountedCostUsd) || accountedCostUsd < 0) throw new Error('Invalid evaluation cost.');
        // Retain uncertain request reservations as accounted cost. If a provider
        // ever reports an anomalously larger charge, record it honestly.
        const result = db.prepare("UPDATE usage SET cost=?,status='settled' WHERE id=? AND status='reserved'").run(accountedCostUsd, id);
        if (result.changes !== 1) throw new Error('The evaluation reservation could not be settled.');
        settled = true;
      }, close() { db.close(); },
    };
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); if (!reserved) db.close(); throw error; }
}
