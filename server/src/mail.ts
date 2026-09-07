import { convert } from 'html-to-text';
import { EventFields, type Fields, type SourceMessage } from './domain.ts';

export type GmailPart = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId: string; internalDate?: string; labelIds?: string[]; payload?: GmailPart };
export const excluded = (message: GmailMessage) => (message.labelIds || []).some(label => ['SPAM', 'TRASH', 'DRAFT'].includes(label));
export function header(message: GmailMessage, name: string) { return message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''; }
export function parts(part?: GmailPart): GmailPart[] { return part ? [part, ...(part.parts || []).flatMap(parts)] : []; }
export const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf8');
export function stripQuotes(value: string, limit = 9000): string {
  const lines = value.replace(/\r\n/g, '\n').split('\n'); const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*(?:On .{5,200}wrote:|Le .{5,200}écrit\s*:|Am .{5,200}schrieb|_{5,}|-{2,}\s*Original Message\s*-{2,})\s*$/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
}
export function readableText(message: GmailMessage, limit = 9000, removeQuotes = true): string {
  const leaves = parts(message.payload).filter(p => !p.filename);
  const plain = leaves.filter(p => p.mimeType === 'text/plain' && p.body?.data).map(p => decode(p.body!.data!));
  const clean = (value: string) => removeQuotes ? stripQuotes(value, limit) : value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
  if (plain.length) return clean(plain.join('\n'));
  const html = leaves.filter(p => p.mimeType === 'text/html' && p.body?.data).map(p => decode(p.body!.data!)).join('\n').slice(0, 250000);
  return clean(convert(html, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }, ...(removeQuotes ? [{ selector: 'blockquote', format: 'skip' }, { selector: '.gmail_quote', format: 'skip' }] : []), { selector: 'style', format: 'skip' }, { selector: 'script', format: 'skip' }] }));
}
const unescapeIcs = (value: string) => value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
export function parseSingleIcs(text: string): SourceMessage['calendar'] {
  if (text.length > 65536) return undefined;
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  if (lines.filter(line => line.toUpperCase() === 'BEGIN:VEVENT').length !== 1 || lines.some(line => /^(RRULE|RDATE|EXDATE|RECURRENCE-ID)[;:]/i.test(line))) return undefined;
  const fields = new Map<string, { params: string; value: string }>(); let inEvent = false; let nested = 0; let method: string | undefined;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; continue; } if (line === 'END:VEVENT') { inEvent = false; continue; }
    if (!inEvent) { if (/^METHOD:/i.test(line)) method = line.slice(7).trim(); continue; }
    if (line.startsWith('BEGIN:')) { nested++; continue; } if (line.startsWith('END:')) { nested--; continue; } if (nested) continue;
    const colon = line.indexOf(':'); if (colon < 0) continue; const key = line.slice(0, colon).split(';')[0]!.toUpperCase(); fields.set(key, { params: line.slice(0, colon), value: unescapeIcs(line.slice(colon + 1)) });
  }
  function datePart(key: string) {
    const item = fields.get(key); if (!item) return {};
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(item.value); if (!match) return {};
    const zone = /(?:^|;)TZID="?([^;" ]+)"?/i.exec(item.params)?.[1];
    return { date: `${match[1]}-${match[2]}-${match[3]}`, time: match[4] ? `${match[4]}:${match[5]}` : undefined, timeZone: match[7] ? 'Etc/UTC' : zone };
  }
  const start = datePart('DTSTART'); const end = datePart('DTEND');
  const candidate = EventFields.safeParse({ title: fields.get('SUMMARY')?.value || 'Calendar invitation', ...start, endDate: end.date, endTime: end.time, endTimeZone: end.timeZone, kind: 'other', location: fields.get('LOCATION')?.value || '', detail: fields.get('DESCRIPTION')?.value.slice(0, 6000) || '' });
  if (!candidate.success || !candidate.data.date) return undefined;
  if (fields.get('STATUS')?.value === 'CANCELLED') method = 'CANCEL';
  return { fields: candidate.data, uid: fields.get('UID')?.value, method };
}
export function normalizeMessage(message: GmailMessage, thread: GmailMessage[], calendars: string[] = []): SourceMessage {
  const date = (input: GmailMessage) => { const time = Number(input.internalDate); return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : ''; };
  const inlineCalendars = parts(message.payload).filter(p => (p.mimeType === 'text/calendar' || p.filename?.toLowerCase().endsWith('.ics')) && p.body?.data).map(p => decode(p.body!.data!));
  const calendarTexts = [...inlineCalendars, ...calendars]; const calendar = calendarTexts.length === 1 ? parseSingleIcs(calendarTexts[0]!) : undefined;
  const attachments = parts(message.payload).filter(p => p.filename || (p.body?.attachmentId && p.mimeType !== 'text/plain' && p.mimeType !== 'text/html'));
  const unsupportedAttachments = attachments.filter(p => !calendar || !(p.mimeType === 'text/calendar' || p.filename?.toLowerCase().endsWith('.ics'))).map(p => (p.filename || p.mimeType || 'attachment').slice(0, 160));
  if (calendarTexts.length && !calendar && !unsupportedAttachments.some(x => x.endsWith('.ics'))) unsupportedAttachments.push('Calendar attachment needs manual review');
  const context = thread.filter(m => m.id !== message.id && !excluded(m)).sort((a, b) => Number(a.internalDate) - Number(b.internalDate)).slice(-8).map(m => ({ id: m.id, from: header(m, 'From').slice(0, 400), sentByOwner: Boolean(m.labelIds?.includes('SENT')), sentAt: date(m), text: readableText(m, 1600) }));
  const fullText = readableText(message, 9000, false); const normalize = (value: string) => value.replace(/\s+/g, ' ').toLowerCase();
  const isForward = /^(?:fwd?|wg):/i.test(header(message, 'Subject')) || /(?:forwarded message|begin forwarded message)/i.test(fullText);
  const redundantQuote = !isForward && context.some(item => item.text.length >= 40 && normalize(fullText).includes(normalize(item.text.slice(0, 300))));
  return { id: message.id, threadId: message.threadId, from: header(message, 'From').slice(0, 400), to: header(message, 'To').slice(0, 800), subject: header(message, 'Subject').slice(0, 500), receivedAt: date(message), sentByOwner: Boolean(message.labelIds?.includes('SENT')), text: redundantQuote ? readableText(message) : fullText, context, calendar, unsupportedAttachments };
}
export function sourceCorpus(source: SourceMessage): string { return [source.subject, source.text, ...source.context.map(x => x.text), source.calendar ? JSON.stringify(source.calendar) : '', ...source.unsupportedAttachments].join('\n'); }
export function fieldsOnly(event: Fields & Record<string, unknown>): Fields { const { title, date, time, endDate, endTime, timeZone, endTimeZone, kind, location, detail, reference } = event; return EventFields.parse({ title, date, time, endDate, endTime, timeZone, endTimeZone, kind, location, detail, reference }); }
