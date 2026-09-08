'use client';
import { useId, useState, type SyntheticEvent } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { EventFields } from '../calendar/types';
import { demoTitle, validateDemoFields } from './state';

export default function DemoForm({ initial, label, onSave }: { initial: EventFields; label: string; onSave: (fields: EventFields) => void }) {
  const [fields, setFields] = useState<EventFields>({ ...initial, title: demoTitle({ ...initial, attendance: 'confirmed' }), attendance: initial.attendance ?? 'confirmed' }); const [error, setError] = useState(''); const id = useId();
  const change = (key: keyof EventFields, value: string) => { setFields(previous => ({ ...previous, [key]: value })); setError(''); };
  function submit(event: SyntheticEvent<HTMLFormElement>) { event.preventDefault(); const validation = validateDemoFields(fields); if (validation) { setError(validation); return; } onSave(fields); }
  return <form className="personal-form demo-form" onSubmit={submit}>
    <label className="field-label" htmlFor={`${id}-title`}>What’s the plan?<Input id={`${id}-title`} value={fields.title} onChange={event => change('title', event.target.value)} required maxLength={200} /></label>
    <div className="form-pair">
      <label className="field-label" htmlFor={`${id}-date`}>Date<Input id={`${id}-date`} type="date" value={fields.date || ''} onChange={event => change('date', event.target.value)} required min="1000-01-01" max="9999-12-31" /></label>
      <label className="field-label" htmlFor={`${id}-time`}>Time <small>optional</small><Input id={`${id}-time`} type="time" value={fields.time || ''} onChange={event => change('time', event.target.value)} /></label>
    </div>
    {!fields.date && <p className="demo-date-help">The original message date is missing. Choose a date to continue.</p>}
    {initial.timeZone && <p className="form-help">Start time is in {initial.timeZone}.</p>}
    {(fields.kind === 'stay' || initial.endDate || initial.endTime) && <div className="form-pair">
      <label className="field-label" htmlFor={`${id}-end-date`}>{fields.kind === 'stay' ? 'Checkout date' : 'End date'}<Input id={`${id}-end-date`} type="date" value={fields.endDate || ''} onChange={event => change('endDate', event.target.value)} min={fields.date} required={fields.kind === 'stay'} /></label>
      <label className="field-label" htmlFor={`${id}-end-time`}>{initial.kind === 'travel' ? 'Arrival time' : 'End time'} <small>optional</small><Input id={`${id}-end-time`} type="time" value={fields.endTime || ''} onChange={event => change('endTime', event.target.value)} /></label>
    </div>}
    {initial.endTimeZone && <p className="form-help">Arrival time is in {initial.endTimeZone}.</p>}
    <label className="field-label" htmlFor={`${id}-place`}>Place<Input id={`${id}-place`} value={fields.location} onChange={event => change('location', event.target.value)} maxLength={500} placeholder="Place not supplied" /></label>
    <label className="field-label" htmlFor={`${id}-notes`}>Notes <small>optional</small><Textarea id={`${id}-notes`} value={fields.detail} onChange={event => change('detail', event.target.value)} maxLength={2000} rows={2} /></label>
    <fieldset className="attendance-choice"><legend>Attendance</legend><div>{(['confirmed', 'invited'] as const).map(attendance => <label className={`attendance-option ${fields.attendance === attendance ? 'is-active' : ''}`} key={attendance}><input type="radio" name={`${id}-attendance`} value={attendance} checked={fields.attendance === attendance} onChange={() => setFields(previous => ({ ...previous, attendance }))} />{attendance === 'confirmed' ? 'Confirmed' : 'Invitation'}</label>)}</div></fieldset>
    {error && <p role="alert" className="personal-inline-error">{error}</p>}
    <div className="demo-form-end"><Button type="submit" className="primary-action" disabled={!fields.date || !fields.title.trim()}>{label}<ArrowUpRight size={16} /></Button><span>Only changes this demo. No RSVP is sent.</span></div>
  </form>;
}
