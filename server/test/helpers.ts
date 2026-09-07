import { randomBytes } from 'node:crypto';
import { readConfig } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { type Fields, type GmailConnection, type Proposal, type SourceMessage } from '../src/domain.ts';
import type { GmailMessage } from '../src/mail.ts';
import type { GmailProvider } from '../src/gmail.ts';
import type { ExtractionResult, Interpreter } from '../src/interpreter.ts';

export const config = () => readConfig({ CALENDAR_SERVICE_TOKEN: randomBytes(32).toString('hex'), CALENDAR_ENCRYPTION_KEY: randomBytes(32).toString('hex'), GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret', GMAIL_ALLOWED_EMAIL: 'owner@example.test' });
export function fixture() { const env = config(); const store = new Store(':memory:', env.CALENDAR_ENCRYPTION_KEY); return { config: env, store }; }
export const fields = (patch: Partial<Fields> = {}): Fields => ({ title: 'Dinner at Luca', date: '2026-09-08', time: '19:30', kind: 'food', location: 'London', detail: '', ...patch });
export const connection = (historyId?: string): GmailConnection => ({ ownerId: 'owner', email: 'owner@example.test', status: 'connected', lastSyncAt: null, nextSyncAt: new Date().toISOString(), historyId, error: null, warning: null });
export const mail = (id = 'm1', text = 'Your table at Luca is confirmed for 8 September 2026 at 19:30.', labels = ['INBOX']): GmailMessage => ({ id, threadId: `thread-${id}`, labelIds: labels, internalDate: '1788782400000', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'unfamiliar@example.test' }, { name: 'To', value: 'owner@example.test' }, { name: 'Subject', value: 'Your booking' }], body: { data: Buffer.from(text).toString('base64url') } } });
export const source = (id = 'm1', text = 'Your table at Luca is confirmed for 8 September 2026 at 19:30.'): SourceMessage => ({ id, threadId: `thread-${id}`, from: 'unfamiliar@example.test', to: 'owner@example.test', receivedAt: '2026-09-07T12:00:00Z', sentByOwner: false, subject: 'Your booking', text, context: [], unsupportedAttachments: [] });
export const proposal = (patch: Partial<Omit<Proposal, 'id' | 'revision' | 'status' | 'createdAt'>> = {}): Omit<Proposal, 'id' | 'revision' | 'status' | 'createdAt'> => ({ action: 'create', event: fields(), attendance: 'confirmed', reason: 'The booking is confirmed.', evidence: ['Your table at Luca is confirmed'], unresolvedFields: [], sourceMessageIds: ['m1'], ...patch });
export function output(event: Fields = fields(), patch: Partial<ExtractionResult['proposals'][number]> = {}): ExtractionResult {
  return { proposals: [{ action: 'create', targetEventId: null, event: { title: event.title, date: event.date || null, time: event.time || null, endDate: event.endDate || null, endTime: event.endTime || null, timeZone: event.timeZone || null, endTimeZone: event.endTimeZone || null, kind: event.kind, location: event.location, detail: event.detail, reference: event.reference || null }, attendance: 'confirmed', reason: 'The booking is confirmed.', evidence: ['Your table at Luca is confirmed'], unresolvedFields: [], ...patch }] };
}
export const interpreter = (result = output()): Interpreter => ({ triage: async () => ({ decision: 'relevant', reason: 'Booking confirmation' }), extract: async () => result });
export const provider = (patch: Partial<GmailProvider> = {}): GmailProvider => ({ profile: async () => ({ emailAddress: 'owner@example.test', historyId: '100' }), list: async () => ({ messages: [{ id: 'm1' }] }), history: async () => ({ historyId: '200', history: [] }), message: async id => mail(id), thread: async () => [], attachment: async () => '', ...patch });
