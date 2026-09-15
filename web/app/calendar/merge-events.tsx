'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { eventDisplayTitle } from './attendance';
import type { CalendarEvent } from './types';

export function mergePreview(keep: CalendarEvent, duplicate: CalendarEvent): CalendarEvent {
  return { ...keep, location: keep.location || duplicate.location, detail: keep.detail || duplicate.detail, reference: keep.reference || duplicate.reference };
}

const dateText = (event: CalendarEvent) => new Date(`${event.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function MergeSummary({ event, label }: { event: CalendarEvent; label: string }) {
  return <section className="merge-summary" aria-label={label}>
    <small>{label}</small>
    <h3>{eventDisplayTitle(event)}</h3>
    <p>{dateText(event)} · {event.time || 'Time not supplied'}{event.timeZone ? ` · ${event.timeZone}` : ''}</p>
    {event.endDate || event.endTime ? <p>Ends: {event.endDate || event.date} · {event.endTime || 'Time not supplied'}{event.endTimeZone ? ` · ${event.endTimeZone}` : ''}</p> : null}
    <p>{event.location || 'Location not supplied'}</p>
    {event.detail ? <p className="merge-description">{event.detail}</p> : null}
    {event.reference ? <p>Reference: {event.reference}</p> : null}
    <small>Saved from {event.source}</small>
  </section>;
}

export default function MergeEvents({ active, events, busy, onMerge, onBack }: {
  active: CalendarEvent; events: CalendarEvent[]; busy: boolean;
  onMerge: (keep: CalendarEvent, duplicate: CalendarEvent) => Promise<void>; onBack: () => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [keepSelected, setKeepSelected] = useState(false);
  const selectId = useId();
  const duplicate = events.find(event => event.id === selectedId && event.id !== active.id);
  const keep = duplicate && keepSelected ? duplicate : active;
  const remove = duplicate ? keepSelected ? active : duplicate : null;
  const choices = events.filter(event => event.id !== active.id).sort((a, b) =>
    Number(b.date === active.date) - Number(a.date === active.date) || a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  return <div className="merge-events">
    <MergeSummary event={active} label="This event" />
    <label htmlFor={selectId}>Choose the other copy</label>
    <select id={selectId} value={selectedId} disabled={busy} onChange={event => { setSelectedId(event.target.value); setKeepSelected(false); }}>
      <option value="">Select an event…</option>
      {choices.map(event => <option key={event.id} value={event.id}>{dateText(event)} · {event.time || 'No time'} · {eventDisplayTitle(event)} · {event.source}{event.id === selectedId ? ' (selected)' : ''}</option>)}
    </select>
    <p className="connection-small">Events on the same date appear first. Choose only another copy of the same plan.</p>
    {duplicate && remove ? <>
      <MergeSummary event={duplicate} label="Other copy" />
      <Button variant="ghost" className="quiet-action" disabled={busy} onClick={() => setKeepSelected(value => !value)}>
        {keepSelected ? 'Keep this event instead' : 'Keep the other copy instead'}
      </Button>
      <MergeSummary event={mergePreview(keep, remove)} label="After merging — one event" />
      <p className="connection-small">The event above keeps its date, time, invitation status and reminders. Only blank location, description and reference fields are filled from the other copy. Conflicting details from the removed copy won’t appear in your calendar.</p>
      <p className="connection-small">Your existing iPhone subscription will reflect this when Apple Calendar next refreshes. No new subscription is needed.</p>
    </> : null}
    <div className="personal-actions">
      <Button className="primary-action" disabled={busy || !remove} onClick={() => { if (remove) void onMerge(keep, remove); }}>{busy ? 'Merging…' : 'Merge into one event'}</Button>
      <Button variant="ghost" className="quiet-action" disabled={busy} onClick={onBack}>Back</Button>
    </div>
  </div>;
}
