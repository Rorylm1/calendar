import { z } from 'zod';
import { EventFields, DateValue, type CalendarEvent, type SourceMessage } from '../src/domain.ts';
import { Extraction, type ExtractionResult, type Interpreter, type TriageResult } from '../src/interpreter.ts';
import { ProcessingPaused } from '../src/errors.ts';
import type { Store } from '../src/store.ts';
import { corpus, type EvaluationCase, type ExpectedProposal } from './corpus.ts';

const instant = z.string().refine(value => Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value));
const event = EventFields.extend({ id: z.string().startsWith('synthetic-'), date: DateValue, source: z.enum(['Gmail', 'Manual']), revision: z.number().int().positive() });
const source = z.object({
  id: z.string().startsWith('eval-'), threadId: z.string().startsWith('eval-'), from: z.email().endsWith('@example.test'), to: z.email().endsWith('@example.test'),
  subject: z.string().max(240), receivedAt: instant, sentByOwner: z.boolean(), text: z.string().min(1).max(8192),
  context: z.array(z.object({ id: z.string().startsWith('synthetic-'), from: z.email().endsWith('@example.test'), sentByOwner: z.boolean(), sentAt: instant, text: z.string().max(8192) }).strict()).max(5),
  unsupportedAttachments: z.array(z.string().max(240)).max(5),
}).strict();
const expectedFields = Extraction.shape.proposals.element.shape.event.pick({ date: true, time: true, endDate: true, endTime: true, timeZone: true, endTimeZone: true, kind: true, location: true, reference: true }).partial().required({ kind: true }).strict();
const expectedProposal = z.object({ action: z.enum(['create', 'update', 'cancel']), targetEventId: z.string().startsWith('synthetic-').nullable(), attendance: z.enum(['confirmed', 'invited', 'unknown', 'declined']), fields: expectedFields, missingContext: z.array(z.enum(['date', 'time', 'endDate', 'endTime', 'attendance', 'location', 'targetEventId'])).max(7) }).strict();
const example = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), label: z.string().min(1).max(240), tags: z.array(z.string()).min(1), synthetic: z.literal(true),
  referenceTime: instant, referenceTimeZone: z.literal('Europe/London'), source,
  existingEvents: z.array(event).max(5), pendingProposals: z.array(z.object({ id: z.string().startsWith('synthetic-'), action: z.enum(['create', 'update', 'cancel']), event: EventFields, attendance: z.enum(['confirmed', 'invited', 'unknown', 'declined']), reason: z.string(), evidence: z.array(z.string()), unresolvedFields: z.array(z.string()), status: z.literal('pending'), revision: z.number().int().positive(), sourceMessageIds: z.array(z.string().startsWith('synthetic-')), createdAt: instant }).strict()).max(5),
  expected: z.object({ triage: z.enum(['pass', 'reject']), proposals: z.array(expectedProposal).max(4), rationale: z.string().min(20) }).strict(),
}).strict();

export function validateCorpus(input: unknown = corpus): EvaluationCase[] {
  const cases = z.array(example).length(50).parse(input) as EvaluationCase[];
  if (new Set(cases.map(item => item.id)).size !== cases.length || new Set(cases.map(item => item.source.id)).size !== cases.length) throw new Error('Evaluation ids must be unique.');
  for (const item of cases) {
    if (item.referenceTime !== item.source.receivedAt) throw new Error(`Timestamp mismatch: ${item.id}`);
    if (item.source.subject === item.label || item.source.id.includes(item.id) || item.source.threadId.includes(item.id)) throw new Error(`Curator labels must not leak into model input: ${item.id}`);
    if (item.expected.triage === 'reject' && item.expected.proposals.length) throw new Error(`A rejected case cannot expect proposals: ${item.id}`);
    for (const proposal of item.expected.proposals) {
      if (proposal.action === 'create' && proposal.targetEventId !== null) throw new Error(`A create cannot target an existing event: ${item.id}`);
      if (proposal.targetEventId && !item.existingEvents.some(event => event.id === proposal.targetEventId)) throw new Error(`Unknown expected target: ${item.id}`);
      const fields = Object.fromEntries(Object.entries(proposal.fields).filter(([, value]) => value !== null));
      EventFields.partial().parse(fields);
    }
  }
  return cases;
}

type Actual = ExtractionResult['proposals'][number];
export type FieldMismatch = { field: string; expected: unknown; actual: unknown };
function canonicalMissing(value: string): string {
  const word = value.replace(/[^a-z]/gi, '').toLowerCase();
  if (/timezone/.test(word)) return value;
  if (/(target|existing|matching|original).*event|event.*(match|id)|targeteventid/.test(word)) return 'targetEventId';
  if (/attendance|rsvp|acceptance|confirmation|confirmed|availability/.test(word)) return 'attendance';
  if (/location|venue|address|place/.test(word)) return 'location';
  if (/(end|checkout|arrival).*date/.test(word)) return 'endDate';
  if (/(end|checkout|arrival).*time/.test(word)) return 'endTime';
  if (/date|day/.test(word)) return 'date';
  if (/time/.test(word)) return 'time';
  return value;
}
function compare(expected: ExpectedProposal, actual?: Actual): { checked: number; correct: number; mismatches: FieldMismatch[] } {
  const checks: [string, unknown, unknown][] = [['action', expected.action, actual?.action], ['targetEventId', expected.targetEventId, actual?.targetEventId], ['attendance', expected.attendance, actual?.attendance]];
  for (const [field, value] of Object.entries(expected.fields)) checks.push([field, value, actual?.event[field as keyof Actual['event']]]);
  const unresolved = new Set(actual?.unresolvedFields.map(canonicalMissing));
  for (const required of expected.missingContext) checks.push([`unresolvedFields.${required}`, true, unresolved.has(required)]);
  const mismatches = checks.filter(([, expected, actual]) => expected !== actual).map(([field, expected, actual]) => ({ field, expected, actual: actual ?? null }));
  return { checked: checks.length, correct: checks.length - mismatches.length, mismatches };
}
export function scoreProposals(expected: ExpectedProposal[], actual: Actual[]) {
  // Match each leg to its closest remaining candidate, prioritising date/time
  // identity before checking all labelled fields. Extras never disappear.
  const available = new Set(actual.map((_, index) => index)); const pairs: { expectedIndex: number; actualIndex: number | null; mismatches: FieldMismatch[] }[] = [];
  let checked = 0; let correct = 0; let fullyCorrect = 0;
  for (const [expectedIndex, target] of expected.entries()) {
    let selected: number | undefined; let best = -Infinity;
    for (const index of available) {
      const value = actual[index]!; const result = compare(target, value);
      const identity = Number(target.action === value.action) * 20 + Number(target.targetEventId === value.targetEventId) * 20 + Number(target.fields.kind === value.event.kind) * 10 + Number(target.fields.date === value.event.date) * 10 + Number(target.fields.time === value.event.time) * 10;
      const quality = identity + result.correct / Math.max(1, result.checked);
      if (quality > best) { selected = index; best = quality; }
    }
    if (selected !== undefined) available.delete(selected);
    const result = compare(target, selected === undefined ? undefined : actual[selected]); checked += result.checked; correct += result.correct;
    if (result.mismatches.length === 0) fullyCorrect++;
    pairs.push({ expectedIndex, actualIndex: selected ?? null, mismatches: result.mismatches });
  }
  return { expectedCount: expected.length, actualCount: actual.length, fullyCorrect, checkedFields: checked, correctFields: correct, extraProposalIndexes: [...available], pairs };
}

export type CaseResult = {
  id: string; expectedTriage: 'pass' | 'reject'; actualTriage?: TriageResult['decision']; triageCorrect?: boolean;
  status: 'completed' | 'budget_limited' | 'failed'; error?: 'budget_limit' | 'provider_error' | 'invalid_output';
  proposals?: ReturnType<typeof scoreProposals>; accountedCostUsd: number;
};
const fraction = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
export function summarize(results: CaseResult[], totalCases: number) {
  const judged = results.filter(result => result.actualTriage); let truePositive = 0; let falsePositive = 0; let trueNegative = 0; let falseNegative = 0;
  for (const item of judged) {
    const pass = item.actualTriage !== 'irrelevant';
    if (item.expectedTriage === 'pass') { if (pass) truePositive++; else falseNegative++; }
    else if (pass) falsePositive++; else trueNegative++;
  }
  const scored = results.filter(result => result.proposals).map(result => result.proposals!);
  const expected = scored.reduce((sum, result) => sum + result.expectedCount, 0); const actual = scored.reduce((sum, result) => sum + result.actualCount, 0); const correct = scored.reduce((sum, result) => sum + result.fullyCorrect, 0);
  const fields = scored.reduce((sum, result) => sum + result.checkedFields, 0); const correctFields = scored.reduce((sum, result) => sum + result.correctFields, 0);
  return { requestedCases: totalCases, attemptedCases: results.length, completedCases: results.filter(result => result.status === 'completed').length, notAttemptedCases: totalCases - results.length,
    triage: { truePositive, falsePositive, trueNegative, falseNegative, precision: fraction(truePositive, truePositive + falsePositive), recall: fraction(truePositive, truePositive + falseNegative), missedCaseIds: judged.filter(result => result.expectedTriage === 'pass' && result.actualTriage === 'irrelevant').map(result => result.id) },
    extraction: { scoredCases: scored.length, expectedProposals: expected, actualProposals: actual, fullyCorrectProposals: correct, precision: fraction(correct, actual), recall: fraction(correct, expected), checkedFields: fields, correctFields, fieldAccuracy: fraction(correctFields, fields) },
  };
}

export async function runEvaluation(cases: EvaluationCase[], interpreter: Interpreter, store: Store): Promise<{ results: CaseResult[]; summary: ReturnType<typeof summarize> }> {
  const results: CaseResult[] = [];
  for (const item of cases) {
    const before = store.spend(); const result: CaseResult = { id: item.id, expectedTriage: item.expected.triage, status: 'completed', accountedCostUsd: 0 };
    try {
      const triage = await interpreter.triage(structuredClone(item.source) as SourceMessage);
      if (!['relevant', 'irrelevant', 'uncertain'].includes(triage.decision)) throw new z.ZodError([]);
      result.actualTriage = triage.decision; result.triageCorrect = (triage.decision !== 'irrelevant') === (item.expected.triage === 'pass');
      const output = triage.decision === 'irrelevant' ? { proposals: [] } : Extraction.parse(await interpreter.extract(structuredClone(item.source), structuredClone(item.existingEvents) as CalendarEvent[], structuredClone(item.pendingProposals)));
      result.proposals = scoreProposals(item.expected.proposals, output.proposals);
    } catch (error) {
      result.status = error instanceof ProcessingPaused && error.reason === 'paused_budget' ? 'budget_limited' : 'failed';
      result.error = result.status === 'budget_limited' ? 'budget_limit' : error instanceof z.ZodError ? 'invalid_output' : 'provider_error';
    }
    result.accountedCostUsd = Math.max(0, store.spend() - before); results.push(result);
    if (result.status !== 'completed') break; // No automatic retries or repeated paid failures.
  }
  return { results, summary: summarize(results, cases.length) };
}
