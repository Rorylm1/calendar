'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Inbox, Mail, MapPin, MessageSquare, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { CalendarEvent, EventFields } from '../calendar/types';
import { DEMO_DATE, SAMPLES, type SampleId } from './fixtures';
import { dateLabel, demoDate, eventWhen, isoDate, MONTHS } from './dates';
import { demoReducer, demoTitle, initialDemoState, validateDemoFields } from './state';
import DemoMonth from './demo-month';
import DemoForm from './demo-form';

type Modal = 'samples' | 'review' | 'proposal' | 'event' | 'edit' | 'remove' | 'reset' | null;
export default function DemoClient() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemoState);
  const [selected, setSelected] = useState(DEMO_DATE); const [view, setView] = useState({ year: 2026, month: 8 }); const [peek, setPeek] = useState(true);
  const [modal, setModal] = useState<Modal>(null); const [sampleId, setSampleId] = useState<SampleId>('dinner'); const [proposalId, setProposalId] = useState<string | null>(null); const [eventId, setEventId] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null); const tryMessageRef = useRef<HTMLButtonElement>(null);
  const sample = SAMPLES.find(item => item.id === sampleId)!; const proposal = state.proposals.find(item => item.id === proposalId); const active = state.events.find(item => item.id === eventId); const sampleState = state.handled[sampleId];
  useEffect(() => { if (!state.notice) return; const timer = setTimeout(() => dispatch({ type: 'clear-notice' }), 6000); return () => clearTimeout(timer); }, [state.notice]);
  function open(next: Modal, trigger?: HTMLElement) { if (trigger) returnFocus.current = trigger; dispatch({ type: 'clear-error' }); setModal(next); }
  function choose(date: string) { const parsed = demoDate(date); setSelected(date); setView({ year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() }); setPeek(true); }
  function moveMonth(delta: number) { choose(isoDate(new Date(Date.UTC(view.year, view.month + delta, 1, 12)))); }
  function openEvent(event: CalendarEvent, trigger?: HTMLElement) { setEventId(event.id); open('event', trigger); }
  function trySample() {
    if (sampleState === 'pending') { setProposalId(sample.proposal!.id); open('proposal'); return; }
    if (sampleState === 'added') { const event = state.events.find(item => item.id === `demo-${sample.id}`); if (event) { choose(event.date); setModal(null); } return; }
    if (sampleState) return;
    const next = demoReducer(state, { type: 'capture', sampleId });
    dispatch({ type: 'capture', sampleId });
    const added = next.events.find(item => item.id === `demo-${sample.id}`);
    if (added) { choose(added.date); setModal(null); }
    else if (next.handled[sampleId] === 'pending' && sample.proposal) { setProposalId(sample.proposal.id); open('proposal'); }
  }
  function save(fields: EventFields) {
    if (validateDemoFields(fields)) return;
    if (modal === 'proposal' && proposal) dispatch({ type: 'complete', proposalId: proposal.id, fields });
    else if (active) dispatch({ type: 'edit', eventId: active.id, fields });
    else return;
    choose(fields.date!); setModal(null);
  }
  function reset() { dispatch({ type: 'reset' }); choose(DEMO_DATE); setSampleId('dinner'); setProposalId(null); setEventId(null); setModal(null); }
  const title = modal === 'samples' ? 'It starts with a message.' : modal === 'review' ? 'Needs details' : modal === 'proposal' ? 'Fill in the missing detail.' : modal === 'edit' ? 'Edit your sample plan.' : modal === 'remove' ? 'Remove this plan?' : modal === 'reset' ? 'A fresh September?' : (active ? demoTitle(active) : 'Your sample plan');
  return <div className="personal-viewport demo-viewport">
    <main className="calendar-app theme-edge round-two personal-calendar demo-calendar">
      <div className="edge-layout">
        <aside className="r2-rail" aria-label="Demo actions">
          <span className="r2-rail-mark"><CalendarDays size={25} strokeWidth={1.4} /></span>
          <span className="r2-rail-active" aria-label="Calendar"><CalendarDays size={20} /></span>
          <button type="button" aria-label="Try a sample message" onClick={event => open('samples', event.currentTarget)}><MessageSquare size={20} /></button>
          <button type="button" aria-label={`Needs details: ${state.proposals.length} items`} onClick={event => open('review', event.currentTarget)}><Inbox size={20} />{state.proposals.length > 0 && <small>{state.proposals.length}</small>}</button>
          <button type="button" className="r2-rail-settings" aria-label="Reset demo" onClick={event => open('reset', event.currentTarget)}><RotateCcw size={19} /></button>
        </aside>
        <div className="edge-content">
          <header className="personal-header demo-header">
            <a href="/demo" className="personal-wordmark" aria-label="Calendar demo home">calendar<span>.</span></a>
            <span className="demo-badge"><span />Fictional demo</span>
            <div className="personal-header-actions">
              <Button type="button" variant="ghost" className="quiet-action demo-review-button" aria-label={`Needs details: ${state.proposals.length} items`} onClick={event => open('review', event.currentTarget)}><Inbox size={17} /><span>Needs details</span>{state.proposals.length > 0 && <b className="personal-count">{state.proposals.length}</b>}</Button>
              <Button type="button" variant="ghost" className="quiet-action demo-reset-button" aria-label="Reset demo" onClick={event => open('reset', event.currentTarget)}><RotateCcw size={16} /><span>Reset</span></Button>
            </div>
          </header>
          <div className="r2-month-heading demo-month-heading">
            <div className="r2-month-name"><h1>{MONTHS[view.month]}<span>{view.year}</span></h1><span className="r2-month-meta">Your plans, in one place.</span></div>
            <div className="month-navigation">
              <Button type="button" variant="ghost" className="quiet-action" aria-label="Previous month" disabled={view.year <= 1000 && view.month === 0} onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></Button>
              <Button type="button" variant="ghost" className="quiet-action demo-sample-month" onClick={() => choose(DEMO_DATE)}>{view.year === 2026 && view.month === 8 ? 'Sample month' : 'Back to September'}</Button>
              <Button type="button" variant="ghost" className="quiet-action" aria-label="Next month" disabled={view.year >= 9999 && view.month === 11} onClick={() => moveMonth(1)}><ChevronRight size={18} /></Button>
            </div>
            <div className="r2-month-end"><Button ref={tryMessageRef} type="button" className="primary-action demo-try-button" onClick={event => open('samples', event.currentTarget)}><MessageSquare size={16} />Try a message<ArrowUpRight size={16} /></Button></div>
          </div>
          <section className="demo-intro" aria-label="About this demo">
            <div className="demo-intro-copy"><span className="demo-intro-symbol"><ArrowUpRight size={19} /></span><p><strong>From your inbox to your month.</strong><span>Bookings appear automatically. Invitations stay clearly labelled.</span></p></div>
            <span className="demo-scripted">Scripted examples<br />No accounts connected</span>
          </section>
          <DemoMonth events={state.events} year={view.year} month={view.month} selected={selected} peek={peek} onSelect={choose} onPeek={setPeek} onEvent={openEvent} />
          <footer className="r2-foot demo-footer"><span><span className="demo-footer-dot" />Fictional plans. Nothing is saved.</span><span>Made for life beyond your inbox.</span></footer>
        </div>
      </div>
    </main>
    <Dialog open={modal !== null} onOpenChange={isOpen => { if (!isOpen) setModal(null); }}>
      <DialogContent finalFocus={() => returnFocus.current?.isConnected ? returnFocus.current : tryMessageRef.current} className={`mock-dialog theme-edge personal-dialog demo-dialog ${modal === 'samples' ? 'demo-samples-dialog' : ''}`}>
        <DialogTitle className="dialog-title">{title}</DialogTitle>
        <DialogDescription className="dialog-description">{modal === 'samples' ? 'Choose a fictional message to see how it reaches your calendar.' : modal === 'review' ? 'Only missing or unclear details wait here.' : modal === 'proposal' ? 'Supply the missing date. Attendance stays separate.' : modal === 'reset' ? 'Restore the original fictional plans and try the examples again.' : 'Fictional example · changes only last while this page is open.'}</DialogDescription>
        {state.error && <p className="personal-inline-error" role="alert">{state.error}</p>}
        {modal === 'samples' && <div className="demo-samples">
          <div className="demo-sample-options" role="group" aria-label="Choose a sample message">{SAMPLES.map(item => <button type="button" className={`demo-sample-option ${sampleId === item.id ? 'is-active' : ''}`} key={item.id} aria-pressed={sampleId === item.id} onClick={() => setSampleId(item.id)}>{item.source === 'Sample email' ? <Mail size={17} /> : <MessageSquare size={17} />}<span><strong>{item.label}</strong><small>{item.hint}</small></span><ChevronRight size={16} /></button>)}</div>
          <div className="demo-message-area"><div className="demo-message"><div className="demo-message-heading"><span className="source-tag">{sample.source}</span><span>Fictional</span></div><h3>{sample.sender}</h3><p>{sample.body}</p></div>
            {sampleState === 'filtered' ? <div className="demo-filtered" role="status"><Check size={19} /><div><strong>No plan to add.</strong><p>{sample.explanation}</p></div></div> : <p className="demo-message-explanation">{sample.explanation}</p>}
            <div className="demo-message-actions"><Button type="button" className="primary-action" disabled={Boolean(sampleState && !['pending', 'added'].includes(sampleState))} onClick={trySample}>{sampleState === 'pending' ? 'Complete details' : sampleState === 'added' ? 'View on calendar' : sampleState === 'dismissed' ? 'Item dismissed' : sampleState === 'removed' ? 'Plan removed' : sampleState === 'filtered' ? 'Checked' : 'Try this message'}<ArrowRight size={16} /></Button><span>{sampleState && ['dismissed', 'removed'].includes(sampleState) ? 'Reset the demo to try this again.' : 'Scripted example. No message is sent.'}</span></div>
          </div>
        </div>}
        {modal === 'review' && <div className="review-list demo-review-list">{state.proposals.length ? state.proposals.map(item => <article className="suggestion" key={item.id}>
          <div className="suggestion-top"><span className="source-tag">{item.source}</span><span>{item.unresolvedFields.length ? 'Date needed' : item.attendance === 'invited' ? 'Invitation' : 'Ready to review'}</span></div>
          <h3>{item.event.title}</h3><p className="suggestion-date">{eventWhen(item.event)}</p><p className="demo-suggestion-reason">{item.reason}</p>
          <div className="suggestion-actions"><Button type="button" className="primary-action" onClick={() => { setProposalId(item.id); open('proposal'); }}>Complete details<ArrowUpRight size={16} /></Button><Button type="button" variant="ghost" className="quiet-action" onClick={() => dispatch({ type: 'dismiss', proposalId: item.id })}>Dismiss</Button></div>
        </article>) : <div className="review-empty"><span className="demo-empty-icon"><Check size={26} /></span><h3>A little breathing room.</h3><p>Bookings and invitations appear automatically. Only missing details need your help.</p><Button type="button" className="primary-action" onClick={() => open('samples')}>Try a message<ArrowRight size={16} /></Button></div>}</div>}
        {modal === 'proposal' && proposal && <div className="demo-proposal">
          <button type="button" className="demo-back" onClick={() => open('review')}><ArrowLeft size={14} />Needs details</button>
          <div className="demo-proposal-status"><span className="source-tag">{proposal.source}</span><span>{proposal.attendance === 'invited' ? 'Attendance not yet confirmed' : proposal.unresolvedFields.length ? 'A detail needs your help' : 'Booking confirmed'}</span></div>
          <details className="demo-evidence"><summary>View the sample message</summary><blockquote>{proposal.evidence[0]}</blockquote></details>
          <DemoForm key={proposal.id} initial={{ ...proposal.event, attendance: proposal.attendance === 'confirmed' ? 'confirmed' : 'invited' }} label="Save to calendar" onSave={save} />
          <button type="button" className="demo-dismiss" onClick={() => { dispatch({ type: 'dismiss', proposalId: proposal.id }); open('review'); }}>Dismiss this item</button>
        </div>}
        {modal === 'event' && active && <div className="demo-event-detail">
          <div className={`demo-event-kind kind-${active.kind}`}><CalendarDays size={24} strokeWidth={1.5} /></div>
          <div className="booking-line"><CalendarDays size={18} /><span>{dateLabel(active.date, { weekday: 'long', day: 'numeric', month: 'long' })}{active.endDate && ` – ${dateLabel(active.endDate)}`}</span></div>
          <div className="booking-line"><Clock3 size={18} /><span>{active.time || 'Time not supplied'}{active.time && active.timeZone && ` · ${active.timeZone}`}{active.endTime && <><br />{active.kind === 'travel' ? 'Arrival' : 'Until'} {active.endTime}{(active.endTimeZone || active.timeZone) && ` · ${active.endTimeZone || active.timeZone}`}</>}</span></div>
          <div className="booking-line"><MapPin size={18} /><span>{active.location || 'Place not supplied'}</span></div>
          {active.detail && <p className="booking-detail">{active.detail}</p>}<div className="booking-source"><span>{active.source}</span><span><Check size={14} />On the sample calendar</span></div>
          <p className="form-help">{active.attendance === 'invited' ? 'Invited · attendance not confirmed.' : 'Confirmed plan.'} No RSVP is sent.</p>
          <Button type="button" variant="ghost" className="quiet-action" onClick={() => dispatch({ type: 'attendance', eventId: active.id, attendance: active.attendance === 'invited' ? 'confirmed' : 'invited' })}>{active.attendance === 'invited' ? 'I’m going' : 'Mark as invitation'}</Button>
          <div className="demo-event-actions"><Button type="button" className="primary-action" onClick={() => open('edit')}>Edit plan<SlidersHorizontal size={16} /></Button><Button type="button" variant="ghost" className="quiet-action" onClick={() => open('remove')}>Remove</Button></div>
        </div>}
        {modal === 'edit' && active && <DemoForm key={`${active.id}-${active.revision}`} initial={active} label="Save changes" onSave={save} />}
        {modal === 'remove' && active && <div className="demo-confirmation"><p><strong>{demoTitle(active)}</strong> will leave the sample calendar.</p><div className="personal-actions"><Button type="button" className="primary-action" onClick={() => { dispatch({ type: 'remove', eventId: active.id }); setModal(null); }}>Remove plan<X size={16} /></Button><Button type="button" variant="ghost" className="quiet-action" onClick={() => open('event')}>Keep it</Button></div></div>}
        {modal === 'reset' && <div className="demo-confirmation"><p>Your edits and sample changes will be cleared. The original six plans will return.</p><div className="personal-actions"><Button type="button" className="primary-action" onClick={reset}>Reset demo<RotateCcw size={16} /></Button><Button type="button" variant="ghost" className="quiet-action" onClick={() => setModal(null)}>Keep exploring</Button></div></div>}
      </DialogContent>
    </Dialog>
    <output className={`demo-notice ${state.notice && !modal ? 'is-visible' : ''}`} aria-live="polite" aria-atomic="true">{state.notice && <><Check size={16} /><span>{state.notice}</span></>}</output>
  </div>;
}
