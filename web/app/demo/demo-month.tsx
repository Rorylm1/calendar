'use client';
import { useRef, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { ArrowUpRight, X } from 'lucide-react';
import type { CalendarEvent } from '../calendar/types';
import { dateLabel, demoDate, eventsOnDate, isoDate, monthCells, MONTHS, timeOnDay, WEEKDAYS } from './dates';

type Props = { events: CalendarEvent[]; year: number; month: number; selected: string; peek: boolean; onSelect: (date: string) => void; onPeek: (open: boolean) => void; onEvent: (event: CalendarEvent, trigger: HTMLButtonElement) => void };
export default function DemoMonth({ events, year, month, selected, peek, onSelect, onPeek, onEvent }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null); const reopenRef = useRef<HTMLButtonElement>(null); const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const entries = eventsOnDate(events, selected);
  function togglePeek(open: boolean) { flushSync(() => onPeek(open)); (open ? closeRef : reopenRef).current?.focus(); }
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in moves)) return;
    event.preventDefault(); const next = demoDate(date); next.setUTCDate(next.getUTCDate() + moves[event.key]); const value = isoDate(next);
    flushSync(() => onSelect(value)); dayRefs.current.get(value)?.focus();
  }
  return <div className="edge-month demo-month">
    <div className="calendar" role="group" aria-label={`${MONTHS[month]} ${year} sample calendar. Use arrow keys to move between dates.`}>
      <div className="weekday-row" aria-hidden="true">{WEEKDAYS.map(day => <div key={day}>{day}</div>)}</div>
      <div className="calendar-grid">
        {monthCells(year, month).map((day, index) => {
          const date = isoDate(day); const items = eventsOnDate(events, date);
          return <button type="button" key={date} ref={node => { if (node) dayRefs.current.set(date, node); else dayRefs.current.delete(date); }}
            className={`day-cell ${date === selected ? 'is-selected' : ''} ${day.getUTCMonth() !== month ? 'is-other' : ''} ${index % 7 >= 5 ? 'is-weekend' : ''}`}
            aria-label={`${dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${items.length} ${items.length === 1 ? 'plan' : 'plans'}`}
            aria-pressed={date === selected} tabIndex={date === selected ? 0 : -1} onClick={() => onSelect(date)} onKeyDown={event => moveFocus(event, date)}>
            <span className="day-number">{day.getUTCDate()}</span>
            <span className="day-events">{items.slice(0, 2).map(item => <span key={item.id} className={`calendar-event kind-${item.kind} ${item.kind === 'stay' ? 'is-stay' : ''}`}>
              <span className="event-dot" /><span className="event-time">{item.kind === 'stay' && date !== item.date ? '' : item.time}</span>
              <span className="event-full">{item.kind === 'stay' && item.endDate === date ? 'Checkout · ' : ''}{item.title}</span><span className="event-short">{item.title}</span>
            </span>)}{items.length > 2 && <span className="event-overflow">+{items.length - 2} more</span>}</span>
            <span className="mobile-event-count">{items.length > 1 ? `${items.length} plans` : items[0]?.title || ''}</span>
          </button>;
        })}
      </div>
    </div>
    {peek ? <section className={`edge-peek ${(demoDate(selected).getUTCDay() + 6) % 7 >= 3 ? 'peek-left' : ''}`} aria-label="Selected day details">
      <button type="button" className="peek-close" ref={closeRef} onClick={() => togglePeek(false)} aria-label="Close day details"><X size={17} /></button>
      <div className="day-panel">
        <div className="day-heading"><div><span className="overline">{dateLabel(selected, { weekday: 'long' })}</span><h2>{dateLabel(selected)}</h2></div></div>
        <div className="selected-events">{entries.length ? entries.map(event => <button type="button" key={event.id} className="detail-entry" onClick={click => onEvent(event, click.currentTarget)}>
          <span className="detail-copy"><span className="detail-time">{timeOnDay(event, selected)}</span><strong>{event.title}</strong><span className="detail-location">{event.location || 'Place not supplied'}</span></span><ArrowUpRight size={16} />
        </button>) : <div className="personal-empty-day"><p>A little breathing room.</p><span>Confirmed sample plans will appear here.</span></div>}</div>
      </div>
    </section> : <button type="button" ref={reopenRef} className="edge-reopen" onClick={() => togglePeek(true)}><span>{dateLabel(selected, { weekday: 'short', day: 'numeric', month: 'short' })}</span><b>{entries.length} plans</b><ArrowUpRight size={16} /></button>}
  </div>;
}
