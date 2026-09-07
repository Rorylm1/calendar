import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage, parseSingleIcs, readableText } from '../src/mail.ts';
import { mail } from './helpers.ts';

test('HTML tracking and quoted history are removed, real text is retained', () => {
  const input = mail(); input.payload!.mimeType = 'text/html'; input.payload!.body!.data = Buffer.from('<p>Your reservation is confirmed.</p><img src="https://tracker.invalid/pixel"><blockquote>Old invitation</blockquote><p>19:30 on 8 September</p>').toString('base64url');
  assert.equal(readableText(input), 'Your reservation is confirmed.\n\n19:30 on 8 September');
});
test('an acceptance reply keeps fresh text and receives bounded original/sent context', () => {
  const input = mail('reply', "Yes, I'm coming!\n\nOn Monday, Alex wrote:\n> Party Friday", ['SENT']);
  const context = Array.from({ length: 12 }, (_, i) => ({ ...mail(`old${i}`, `Context ${i}`, i % 2 ? ['SENT'] : ['INBOX']), internalDate: String(1000 + i) }));
  const result = normalizeMessage(input, context); assert.ok(result.text.startsWith("Yes, I'm coming!")); assert.equal(result.sentByOwner, true); assert.equal(result.context.length, 8); assert.ok(result.context.some(x => x.sentByOwner));
});
const ics = 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:demo-123\r\nSUMMARY:Dinner at Luca\r\nDTSTART;TZID=Europe/London:20260908T193000\r\nDTEND;TZID=Europe/London:20260908T210000\r\nLOCATION:London\r\nBEGIN:VALARM\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR';
test('single-event ICS preserves timezone, UID, and source times', () => { const result = parseSingleIcs(ics)!; assert.equal(result.fields.time, '19:30'); assert.equal(result.fields.endTime, '21:00'); assert.equal(result.fields.timeZone, 'Europe/London'); assert.equal(result.uid, 'demo-123'); });
test('date-only ICS does not invent midnight; recurrence is flagged for review', () => {
  const result = parseSingleIcs(ics.replace('DTSTART;TZID=Europe/London:20260908T193000', 'DTSTART;VALUE=DATE:20260908').replace('DTEND;TZID=Europe/London:20260908T210000', 'DTEND;VALUE=DATE:20260909'))!;
  assert.equal(result.fields.date, '2026-09-08'); assert.equal(result.fields.time, undefined);
  assert.equal(parseSingleIcs(ics.replace('UID:demo-123', 'UID:demo-123\r\nRRULE:FREQ=WEEKLY')), undefined);
});
test('unsupported PDF is represented by metadata and no fabricated contents', () => {
  const input = mail('pdf', 'See attachment.'); input.payload!.parts = [{ filename: 'train-ticket.pdf', mimeType: 'application/pdf', body: { attachmentId: 'attachment-id' } }];
  const result = normalizeMessage(input, []); assert.deepEqual(result.unsupportedAttachments, ['train-ticket.pdf']); assert.equal(result.calendar, undefined); assert.equal(result.text, 'See attachment.');
});
test('forwarded HTML booking content is preserved when no matching original exists in the thread', () => {
  const input = mail('forward'); input.payload!.headers!.find(h => h.name === 'Subject')!.value = 'Fwd: Our trip'; input.payload!.mimeType = 'text/html'; input.payload!.body!.data = Buffer.from('<p>Our trip is booked.</p><div class="gmail_quote">Your hotel stay is confirmed for 11–13 September 2026.</div>').toString('base64url');
  assert.match(normalizeMessage(input, []).text, /hotel stay is confirmed/);
});
