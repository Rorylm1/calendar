import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhatsAppYear } from '../src/whatsapp-policy.ts';
import { CalendarWorker } from '../src/worker.ts';
import { fields, source, fixture, interpreter, output } from './helpers.ts';

const whatsapp = (text: string, receivedAt = '2026-09-15T10:00:00Z') => ({ ...source('whatsapp:test', text), receivedAt, channel: 'whatsapp' as const, whatsapp: { forwarded: true } });

test('yearless WhatsApp dates use the next occurrence, including today and year boundaries', () => {
  for (const [text, date, expected] of [
    ['7 November', '2025-11-07', '2026-11-07'],
    ['10 January', '2026-01-10', '2027-01-10'],
    ['15 September', '2025-09-15', '2026-09-15'],
    ['14 September', '2026-09-14', '2027-09-14'],
  ]) assert.equal(resolveWhatsAppYear(fields({ date }), whatsapp(text!)).event.date, expected);
  assert.equal(resolveWhatsAppYear(fields({ date: '2026-01-01' }), whatsapp('1 January', '2026-12-31T22:00:00Z')).event.date, '2027-01-01');
});

test('explicit years and absent dates stay unchanged; invalid leap dates need details', () => {
  for (const text of ['12/09/2025', '12/09/25', '12 September 25', 'September 12, 2025']) {
    assert.equal(resolveWhatsAppYear(fields({ date: '2025-09-12' }), whatsapp(text)).event.date, '2025-09-12');
  }
  assert.equal(resolveWhatsAppYear(fields({ date: undefined }), whatsapp('Party in January')).event.date, undefined);
  assert.equal(resolveWhatsAppYear(fields({ date: '2028-02-29' }), whatsapp('29 February')).event.date, undefined);
});

test('receipt day uses London time, remains stable on retries, and stays crossing New Year keep their end date', () => {
  const message = whatsapp('15 September', '2026-09-14T23:30:00Z');
  assert.equal(resolveWhatsAppYear(fields({ date: '2025-09-15' }), message).event.date, '2026-09-15');
  const stay = resolveWhatsAppYear(fields({ date: '2025-12-30', endDate: '2026-01-02', kind: 'stay' }), whatsapp('30 December to 2 January'));
  assert.equal(stay.event.date, '2026-12-30'); assert.equal(stay.event.endDate, '2027-01-02');
  assert.deepEqual(resolveWhatsAppYear(stay.event, whatsapp('30 December to 2 January')), stay);
});

test('a WhatsApp invitation with a year-only ambiguity becomes an accepted dated event', async () => {
  const { config, store } = fixture(); config.WHATSAPP_PROCESSING_ENABLED = true;
  const text = 'Battersea Fireworks this year, 7 November';
  store.capture(whatsapp(text));
  const worker = new CalendarWorker(config, store, () => { throw Error('Gmail must not be used'); }, interpreter(output(fields({ title: 'Battersea Fireworks', date: '2025-11-07', time: undefined }), { attendance: 'invited', unresolvedFields: ['originalDate', 'date'], evidence: [text] })));
  try {
    await worker.process();
    assert.equal(store.events().length, 1);
    assert.equal(store.events()[0]!.date, '2026-11-07'); assert.equal(store.events()[0]!.attendance, 'confirmed');
    assert.equal(store.proposals().filter(p => p.status === 'pending').length, 0);
  } finally { await worker.stop(); store.close(); }
});
