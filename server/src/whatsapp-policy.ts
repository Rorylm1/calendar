import { Temporal } from '@js-temporal/polyfill';
import { DateValue, type Fields, type SourceMessage } from './domain.ts';

export const whatsappReceivedDate = (source: SourceMessage) => Temporal.Instant.from(source.receivedAt).toZonedDateTimeISO('Europe/London').toPlainDate().toString();

/** Anchor retries to receipt day, so reprocessing cannot move a plan into another year. */
export function resolveWhatsAppYear(fields: Fields, source: SourceMessage): { event: Fields; inferredYear: boolean } {
  const event = { ...fields };
  const text = [source.text, ...source.context.map(item => item.text)].join('\n');
  const explicitYear = /\b(?:19|20|21)\d{2}\b/.test(text) || /\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2}\b/.test(text) || /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+['’]?\d{2}(?![\d:])\b/i.test(text);
  if (explicitYear || !event.date) return { event, inferredYear: false };
  const today = whatsappReceivedDate(source);
  let year = Number(today.slice(0, 4));
  let date = `${year}${event.date.slice(4)}`;
  if (date < today) date = `${++year}${event.date.slice(4)}`;
  if (!DateValue.safeParse(date).success) { delete event.date; delete event.endDate; return { event, inferredYear: false }; }
  event.date = date;
  if (event.endDate) {
    let end = `${year}${event.endDate.slice(4)}`;
    if (end < date) end = `${year + 1}${event.endDate.slice(4)}`;
    if (!DateValue.safeParse(end).success) { delete event.date; delete event.endDate; return { event, inferredYear: false }; }
    event.endDate = end;
  }
  return { event, inferredYear: true };
}
