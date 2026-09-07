'use client';
import { signOut } from 'next-auth/react';
import { api } from '@/lib/client-api';
import { stopDeviceNotifications } from '@/lib/push-client';
import DeliverySettings from './delivery-settings';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Inbox,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type {
  CalendarEvent,
  CalendarState,
  EventFields,
  Proposal,
} from './types';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateAtNoon = (s: string) => new Date(`${s}T12:00:00`);
const dateLabel = (
  s: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' },
) => dateAtNoon(s).toLocaleDateString('en-GB', options);
const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const onDate = (events: CalendarEvent[], date: string) =>
  events
    .filter(
      (e) =>
        e.date === date ||
        (e.kind === 'stay' && e.endDate && date >= e.date && date <= e.endDate),
    )
    .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
const clockLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Not yet';
const timeOnDay = (event: CalendarEvent, date: string) => {
  if (
    event.kind === 'stay' &&
    event.endDate &&
    date > event.date &&
    date < event.endDate
  )
    return 'Staying';
  const checkout = event.kind === 'stay' && event.endDate === date;
  const time = checkout ? event.endTime : event.time;
  const zone = checkout ? event.endTimeZone || event.timeZone : event.timeZone;
  return `${checkout ? 'Checkout · ' : ''}${time || 'Time not supplied'}${time && zone ? ` · ${zone}` : ''}`;
};
const eventWhen = (event: EventFields) =>
  `${event.date ? dateLabel(event.date) : 'Date to confirm'}${event.endDate && event.endDate !== event.date ? ` – ${dateLabel(event.endDate)}` : ''} · ${event.time || 'Time not supplied'}${event.timeZone ? ` · ${event.timeZone}` : ''}`;
const blank = (date: string): EventFields => ({
  title: '',
  date,
  kind: 'social',
  location: '',
  detail: '',
});


function EventForm({
  initial,
  onSave,
  busy,
  label,
}: {
  initial: EventFields;
  onSave: (fields: EventFields) => Promise<void>;
  busy: boolean;
  label: string;
}) {
  const [fields, setFields] = useState(initial);
  const formId = useId();
  const change = (key: keyof EventFields, value: string) =>
    setFields((previous) => ({ ...previous, [key]: value }));
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave(fields);
  }
  return (
    <form className="personal-form" onSubmit={submit}>
      <label className="field-label" htmlFor={`${formId}-title`}>
        {' '}
        What’s the plan?
        <Input
          id={`${formId}-title`}
          value={fields.title}
          onChange={(e) => change('title', e.target.value)}
          required
          maxLength={200}
        />
      </label>
      <div className="form-pair">
        <label className="field-label" htmlFor={`${formId}-date`}>
          {' '}
          Date
          <Input
            id={`${formId}-date`}
            type="date"
            value={fields.date || ''}
            onChange={(e) => change('date', e.target.value)}
            required
          />
        </label>
        <label className="field-label" htmlFor={`${formId}-time`}>
          {' '}
          Time <small>optional</small>
          <Input
            id={`${formId}-time`}
            type="time"
            value={fields.time || ''}
            onChange={(e) => change('time', e.target.value)}
          />
        </label>
      </div>
      <label className="field-label" htmlFor={`${formId}-location`}>
        {' '}
        Place
        <Input
          id={`${formId}-location`}
          value={fields.location}
          onChange={(e) => change('location', e.target.value)}
          maxLength={500}
          placeholder="Location not supplied"
        />
      </label>
      <details
        className="more-details"
        open={Boolean(
          initial.endDate ||
          initial.endTime ||
          initial.timeZone ||
          initial.reference,
        )}
      >
        <summary>Booking details</summary>
        <div className="form-pair">
          <label className="field-label" htmlFor={`${formId}-endDate`}>
            {' '}
            End / checkout date
            <Input
              id={`${formId}-endDate`}
              type="date"
              value={fields.endDate || ''}
              min={fields.kind === 'stay' ? fields.date : undefined}
              onChange={(e) => change('endDate', e.target.value)}
            />
          </label>
          <label className="field-label" htmlFor={`${formId}-endTime`}>
            {' '}
            End / arrival time
            <Input
              id={`${formId}-endTime`}
              type="time"
              value={fields.endTime || ''}
              onChange={(e) => change('endTime', e.target.value)}
            />
          </label>
        </div>
        <div className="form-pair">
          <label className="field-label" htmlFor={`${formId}-timeZone`}>
            {' '}
            Start time zone
            <Input
              id={`${formId}-timeZone`}
              value={fields.timeZone || ''}
              placeholder="e.g. Europe/London"
              onChange={(e) => change('timeZone', e.target.value)}
            />
          </label>
          <label className="field-label" htmlFor={`${formId}-endTimeZone`}>
            {' '}
            End time zone
            <Input
              id={`${formId}-endTimeZone`}
              value={fields.endTimeZone || ''}
              placeholder="If different"
              onChange={(e) => change('endTimeZone', e.target.value)}
            />
          </label>
        </div>
        <label className="field-label" htmlFor={`${formId}-kind`}>
          {' '}
          Type
          <select
            id={`${formId}-kind`}
            value={fields.kind}
            onChange={(e) => change('kind', e.target.value)}
          >
            <option value="social">Personal plan</option>
            <option value="food">Restaurant</option>
            <option value="travel">Travel</option>
            <option value="stay">Hotel / stay</option>
            <option value="appointment">Appointment</option>
            <option value="other">Other booking</option>
          </select>
        </label>
        <label className="field-label" htmlFor={`${formId}-reference`}>
          {' '}
          Booking reference
          <Input
            id={`${formId}-reference`}
            value={fields.reference || ''}
            onChange={(e) => change('reference', e.target.value)}
            maxLength={200}
          />
        </label>
        <label className="field-label" htmlFor={`${formId}-detail`}>
          {' '}
          Notes
          <Textarea
            id={`${formId}-detail`}
            value={fields.detail}
            onChange={(e) => change('detail', e.target.value)}
            maxLength={4000}
          />
        </label>
      </details>
      {fields.time && <label className="field-label" htmlFor={`${formId}-reminder`}>Calendar reminder
        <select id={`${formId}-reminder`} value={fields.reminderMinutes === null ? 'off' : String(fields.reminderMinutes ?? 15)} onChange={event => setFields(previous => ({ ...previous, reminderMinutes: event.target.value === 'off' ? null : Number(event.target.value) }))}>
          <option value="off">None</option><option value="0">At the time</option><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option>
          {fields.reminderMinutes != null && ![0,5,15,30,60,1440].includes(fields.reminderMinutes) && <option value={fields.reminderMinutes}>{fields.reminderMinutes} minutes before</option>}
        </select><small>Included in your private Calendar subscription. Enable its alerts on your device.</small>
      </label>}
      <p className="form-help">
        Leave unknown times blank. Nothing is sent to the organiser.
      </p>
      <Button
        type="submit"
        disabled={busy || !fields.title.trim() || !fields.date}
        className="primary-action"
      >
        {busy ? (
          <Loader2 className="spinning" size={16} />
        ) : (
          <Check size={16} />
        )}
        {label}
      </Button>
    </form>
  );
}

export default function CalendarClient() {
  const [today] = useState(() => iso(new Date()));
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState(() => ({
    year: dateAtNoon(today).getFullYear(),
    month: dateAtNoon(today).getMonth(),
  }));
  const [data, setData] = useState<CalendarState | null>(null);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionErrorCode, setActionErrorCode] = useState('');
  const [disconnectWarning, setDisconnectWarning] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<
    | 'connections'
    | 'review'
    | 'add'
    | 'event'
    | 'edit'
    | 'proposal'
    | 'delete'
    | 'disconnect'
    | null
  >(null);
  const [active, setActive] = useState<CalendarEvent | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [peek, setPeek] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const requestNumber = useRef(0);
  const inFlight = useRef(false);
  const signingOut = useRef(false);
  const clearPrivate = useCallback(() => {
    setData(null);
    setActive(null);
    setProposal(null);
    setModal(null);
    setNotice('');
    setActionError('');
    setDisconnectWarning('');
  }, []);
  const refresh = useCallback(async () => {
    if (signingOut.current) return;
    const number = ++requestNumber.current;
    try {
      const result = await api<CalendarState>('state');
      if (number === requestNumber.current) {
        setData(result);
        setError('');
        setErrorCode('');
      }
    } catch (caught) {
      if (number === requestNumber.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Your calendar could not be loaded.',
        );
        const code = (caught as { code?: string }).code || '';
        setErrorCode(code);
        if (['sign_in_required', 'owner_only'].includes(code)) clearPrivate();
      }
    }
  }, [clearPrivate]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void refresh();
      const params = new URLSearchParams(window.location.search);
      if (params.get('review') === '1') { setModal('review'); window.history.replaceState(null, '', '/calendar'); }
      const result = params.get('gmail');
      if (result) {
        setModal('connections');
        setNotice(
          result === 'connected'
            ? 'Gmail connected. Your first check is starting.'
            : result === 'cancelled'
              ? 'Google connection cancelled.'
              : result === 'expired'
                ? 'That connection link expired. Please connect again.'
                : 'Google connection could not be completed. Please try again.',
        );
        window.history.replaceState(null, '', '/calendar');
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [refresh]);
  const processing =
    data?.connection.status === 'syncing' ||
    data?.connection.processingStatus === 'processing';
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      processing ? 4000 : 300000,
    );
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh, processing]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  function choose(date: string) {
    setSelected(date);
    const d = dateAtNoon(date);
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setPeek(true);
  }
  function month(delta: number) {
    choose(iso(new Date(view.year, view.month + delta, 1)));
  }
  function togglePeek(open: boolean) {
    flushSync(() => setPeek(open));
    (open ? closeRef : reopenRef).current?.focus();
  }
  async function act(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setActionError('');
    setActionErrorCode('');
    try {
      await action();
      await refresh();
    } catch (caught) {
      const code = (caught as { code?: string }).code || '';
      if (['sign_in_required', 'owner_only'].includes(code)) {
        clearPrivate();
        setErrorCode(code);
        setError('Sign in to open your personal calendar.');
      } else {
        setActionError(
          caught instanceof Error
            ? caught.message
            : 'That action could not be completed.',
        );
        setActionErrorCode(code);
      }
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function reloadLatest() {
    await act(async () => {
      const result = await api<CalendarState>('state');
      setData(result);
      const latest = result.events.find((event) => event.id === active?.id);
      if (latest) setActive(latest);
      else {
        setActive(null);
        setModal(null);
        setNotice('This plan has been removed.');
      }
    });
  }
  function openEvent(event: CalendarEvent) {
    setActive(event);
    setModal('event');
  }
  async function saveEvent(fields: EventFields) {
    await act(async () => {
      const optional = [
        'time',
        'endDate',
        'endTime',
        'timeZone',
        'endTimeZone',
        'reference',
      ];
      const allowed = [
        'title',
        'date',
        'kind',
        'location',
        'detail',
        'reminderMinutes',
        ...optional,
      ];
      const creating = modal === 'add';
      const clean = Object.fromEntries(
        Object.entries(fields)
          .filter(
            ([key, value]) =>
              allowed.includes(key) &&
              !(creating && optional.includes(key) && !value),
          )
          .map(([key, value]) => [
            key,
            value === '' && optional.includes(key) ? null : value,
          ]),
      );
      if (modal === 'proposal' && proposal)
        await api(`proposals/${proposal.id}/confirm`, 'POST', {
          event: clean,
          expectedRevision: proposal.targetRevision,
        });
      else if (modal === 'edit' && active)
        await api(`events/${active.id}`, 'PATCH', {
          event: clean,
          expectedRevision: active.revision,
        });
      else await api('events', 'POST', clean);
      if (fields.date) choose(fields.date);
      setModal(null);
      setNotice('Plan saved to your calendar.');
    });
  }
  function connect() {
    void act(async () => {
      const result = await api<{ url: string }>('gmail/connect', 'POST', {});
      window.location.assign(result.url);
    });
  }
  const events = data?.events || [];
  const proposals = data?.proposals || [];
  const connection = data?.connection;
  const entries = onDate(events, selected);
  const first = new Date(view.year, view.month, 1);
  const offset = (first.getDay() + 6) % 7;
  const cells = Array.from(
    {
      length:
        Math.ceil(
          (offset + new Date(view.year, view.month + 1, 0).getDate()) / 7,
        ) * 7,
    },
    (_, i) => new Date(view.year, view.month, i + 1 - offset),
  );
  const connected =
    connection?.status === 'connected' || connection?.status === 'syncing';
  const lastChecked = connection?.lastSyncAt
    ? `Checked ${clockLabel(connection.lastSyncAt)}`
    : connected
      ? 'First check pending'
      : 'Connect Gmail';
  const dialogTitle =
    modal === 'connections'
      ? 'Your connections'
      : modal === 'review'
        ? 'A few things to look at'
        : modal === 'proposal'
          ? proposal?.action === 'update'
            ? 'Review this change'
            : 'Make it a plan'
          : modal === 'add'
            ? 'Add a plan'
            : modal === 'edit'
              ? 'Edit your plan'
              : modal === 'delete'
                ? 'Remove this plan?'
                : modal === 'disconnect'
                  ? 'Disconnect Gmail?'
                  : active?.title || 'Your plan';
  return (
    <div className="personal-viewport">
      <main className="calendar-app theme-edge round-two personal-calendar">
        <div className="edge-layout">
          <aside className="r2-rail">
            <span className="r2-rail-mark">
              <CalendarDays size={25} strokeWidth={1.4} />
            </span>
            <span className="r2-rail-active" aria-label="Calendar">
              <CalendarDays size={20} />
            </span>
            <button
              onClick={() => setModal('review')}
              aria-label={`Review ${proposals.length} suggestions`}
            >
              <Inbox size={20} />
              {proposals.length > 0 && <small>{proposals.length}</small>}
            </button>
            <button
              onClick={() => setModal('connections')}
              aria-label="Gmail connection"
            >
              <Mail size={20} />
            </button>
            <button
              className="r2-rail-settings"
              onClick={() => setModal('connections')}
              aria-label="Connections and settings"
            >
              <Settings2 size={19} />
            </button>
          </aside>
          <div className="edge-content">
            <header className="personal-header">
              <a href="/calendar" className="personal-wordmark">
                calendar<span>.</span>
              </a>
              <span className="personal-private">Personal</span>
              <div className="personal-header-actions">
                <Button
                  variant="ghost"
                  className="quiet-action"
                  onClick={() => setModal('review')}
                >
                  <Inbox size={17} />
                  Review
                  {proposals.length > 0 && (
                    <b className="personal-count">{proposals.length}</b>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  className="quiet-action"
                  onClick={() => setModal('connections')}
                  aria-label="Open Gmail connection"
                >
                  <Mail size={17} />
                  <span>Gmail</span>
                </Button>
                <Button variant="ghost" className="quiet-action personal-sign-out" aria-label="Sign out" disabled={busy} onClick={() => { signingOut.current = true; requestNumber.current++; clearPrivate(); setBusy(true); void Promise.race([stopDeviceNotifications().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 3000))]).finally(() => { void signOut({ redirectTo: '/sign-in' }); }); }}>
                  <LogOut size={16} />
                  <span>Sign out</span>
                </Button>
              </div>
            </header>
            <div className="r2-month-heading">
              <div className="r2-month-name">
                <h1>
                  {monthNames[view.month]}
                  <span>{view.year}</span>
                </h1>
                <span className="r2-month-meta">Your plans, in one place.</span>
              </div>
              <div className="month-navigation">
                <Button
                  variant="ghost"
                  className="quiet-action"
                  onClick={() => month(-1)}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={18} />
                </Button>
                <Button
                  variant="ghost"
                  className="quiet-action"
                  onClick={() => choose(today)}
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  className="quiet-action"
                  onClick={() => month(1)}
                  aria-label="Next month"
                >
                  <ChevronRight size={18} />
                </Button>
              </div>
              <div className="r2-month-end">
                <Button
                  className="primary-action"
                  disabled={!data}
                  onClick={() => setModal('add')}
                >
                  <Plus size={17} />
                  Add event
                </Button>
              </div>
            </div>
            {error && (
              <div className="personal-banner" role="alert">
                <span>{error}</span>
                {errorCode === 'sign_in_required' ? (
                  <a
                    href="/sign-in"
                  >
                    Sign in
                  </a>
                ) : (
                  <button onClick={() => void refresh()}>Try again</button>
                )}
              </div>
            )}
            {!data && !error && (
              <output className="personal-loading">
                <Loader2 className="spinning" size={16} />
                Opening your calendar…
              </output>
            )}
            {data && !connected && (
              <div className="personal-connect-strip">
                <span>
                  <Mail size={17} />
                  Bring your bookings into view.
                </span>
                <button onClick={() => setModal('connections')}>
                  {connection?.status === 'reconnect_required'
                    ? 'Reconnect Gmail'
                    : 'Connect Gmail'}
                  <ArrowUpRight size={15} />
                </button>
              </div>
            )}
            <div className="edge-month">
              <div
                className="calendar"
                aria-label={`${monthNames[view.month]} ${view.year}`}
              >
                <div className="weekday-row">
                  {weekdayNames.map((day) => (
                    <div key={day}>{day}</div>
                  ))}
                </div>
                <div className="calendar-grid">
                  {cells.map((day, index) => {
                    const date = iso(day);
                    const items = onDate(events, date);
                    return (
                      <button
                        key={date}
                        className={`day-cell ${date === selected ? 'is-selected' : ''} ${date === today ? 'is-today' : ''} ${day.getMonth() !== view.month ? 'is-other' : ''} ${index % 7 >= 5 ? 'is-weekend' : ''}`}
                        aria-label={`${dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${items.length} plans`}
                        aria-pressed={selected === date}
                        onClick={() => choose(date)}
                      >
                        <span className="day-number">{day.getDate()}</span>
                        <div className="day-events">
                          {items.slice(0, 2).map((event) => (
                            <div
                              key={event.id}
                              className={`calendar-event kind-${event.kind} ${event.kind === 'stay' ? 'is-stay' : ''}`}
                            >
                              <span className="event-dot" />
                              <span className="event-time">
                                {event.kind === 'stay' && date !== event.date
                                  ? event.endDate === date
                                    ? event.endTime
                                    : ''
                                  : event.time}
                              </span>
                              <span className="event-full">
                                {event.kind === 'stay' && event.endDate === date
                                  ? 'Checkout · '
                                  : ''}
                                {event.title}
                              </span>
                              <span className="event-short">{event.title}</span>
                            </div>
                          ))}
                          {items.length > 2 && (
                            <span className="event-overflow">
                              +{items.length - 2} more
                            </span>
                          )}
                        </div>
                        <span className="mobile-event-count">
                          {items.length > 1
                            ? `${items.length} plans`
                            : items[0]?.title || ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {peek ? (
                <section
                  className={`edge-peek ${(dateAtNoon(selected).getDay() + 6) % 7 >= 3 ? 'peek-left' : ''}`}
                  aria-label="Selected day details"
                >
                  <button
                    className="peek-close"
                    ref={closeRef}
                    onClick={() => togglePeek(false)}
                    aria-label="Close day details"
                  >
                    <X size={17} />
                  </button>
                  <div className="day-panel">
                    <div className="day-heading">
                      <div>
                        <span className="overline">
                          {dateLabel(selected, { weekday: 'long' })}
                        </span>
                        <h2>{dateLabel(selected)}</h2>
                      </div>
                    </div>
                    <div className="selected-events">
                      {entries.length ? (
                        entries.map((event) => (
                          <button
                            key={event.id}
                            className="detail-entry"
                            onClick={() => openEvent(event)}
                          >
                            <span className="detail-copy">
                              <span className="detail-time">
                                {timeOnDay(event, selected)}
                              </span>
                              <strong>{event.title}</strong>
                              <span className="detail-location">
                                {event.location || 'Location not supplied'}
                              </span>
                            </span>
                            <ArrowUpRight size={16} />
                          </button>
                        ))
                      ) : (
                        <div className="personal-empty-day">
                          <p>
                            {data
                              ? 'A little breathing room.'
                              : 'Your plans will appear here.'}
                          </p>
                          <Button
                            variant="ghost"
                            className="quiet-action"
                            disabled={!data}
                            onClick={() => setModal('add')}
                          >
                            Add a plan <Plus size={15} />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              ) : (
                <button
                  className="edge-reopen"
                  ref={reopenRef}
                  onClick={() => togglePeek(true)}
                >
                  <span>
                    {dateLabel(selected, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <b>{entries.length} plans</b>
                  <ArrowUpRight size={16} />
                </button>
              )}
            </div>
            <footer className="r2-foot">
              <button
                className="personal-sync"
                onClick={() => setModal('connections')}
              >
                {processing ? (
                  <Loader2 className="spinning" size={13} />
                ) : (
                  <span
                    className={`connection-dot ${connected ? 'connected' : ''}`}
                  />
                )}
                {processing ? 'Checking your plans…' : lastChecked}
              </button>
              <span>Only plans you’ve confirmed</span>
            </footer>
          </div>
        </div>
      </main>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setModal(null);
            setActionError('');
            setActionErrorCode('');
          }
        }}
      >
        <DialogContent className="mock-dialog theme-edge personal-dialog">
          <DialogTitle className="dialog-title">{dialogTitle}</DialogTitle>
          <DialogDescription className="dialog-description">
            {modal === 'connections'
              ? 'Less entering. More looking forward.'
              : modal === 'review' || modal === 'proposal'
                ? 'You decide what becomes a plan.'
                : modal === 'disconnect'
                  ? 'Saved plans remain in your calendar. New email checks will stop.'
                  : modal === 'delete'
                    ? 'This removes it from your calendar. It does not cancel the booking.'
                    : 'Keep the details you need, close at hand.'}
          </DialogDescription>
          {error && (
            <p className="personal-inline-error" role="alert">
              {error}
            </p>
          )}
          {actionError && (
            <div className="personal-inline-error" role="alert">
              <p>{actionError}</p>
              {actionErrorCode === 'revision_conflict' &&
                (modal === 'edit' || modal === 'delete') && (
                  <button
                    className="error-recovery"
                    onClick={() => void reloadLatest()}
                  >
                    Reload latest details
                  </button>
                )}
              {actionErrorCode === 'revision_conflict' &&
                modal === 'proposal' && (
                  <button
                    className="error-recovery"
                    onClick={() => {
                      setActionError('');
                      setModal('review');
                      void refresh();
                    }}
                  >
                    Return to review
                  </button>
                )}
            </div>
          )}
          {modal === 'connections' && (
            <div className="connection-view">
              {disconnectWarning && (
                <div className="personal-inline-error" role="alert">
                  <p>{disconnectWarning}</p>
                  <button
                    className="error-recovery"
                    onClick={() => setDisconnectWarning('')}
                  >
                    Understood
                  </button>
                </div>
              )}
              <div className="connection-heading">
                <span className="connection-icon">
                  <Mail size={25} strokeWidth={1.4} />
                </span>
                <div>
                  <h3>Gmail</h3>
                  <p>
                    {connection?.email || 'Your bookings, brought together.'}
                  </p>
                </div>
                <span className="connection-state">
                  {connected
                    ? 'Connected'
                    : connection?.status === 'reconnect_required'
                      ? 'Reconnect'
                      : 'Not connected'}
                </span>
              </div>
              <p className="connection-explainer">
                Read-only access to find personal plans and dated bookings. New
                suggestions wait for your review.
              </p>
              <p className="connection-explainer">
                Relevant email text is interpreted by Gemini through OpenRouter.{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  How your information is used
                </a>
              </p>
              <dl className="connection-facts">
                <div>
                  <dt>Check frequency</dt>
                  <dd>Every hour</dd>
                </div>
                <div>
                  <dt>First check</dt>
                  <dd>Last 30 days of email</dd>
                </div>
                <div>
                  <dt>Last successful check</dt>
                  <dd>{clockLabel(connection?.lastSyncAt || null)}</dd>
                </div>
                {connected && (
                  <div>
                    <dt>Next check</dt>
                    <dd>{clockLabel(connection?.nextSyncAt || null)}</dd>
                  </div>
                )}
                {Boolean(connection?.pendingMessages) && (
                  <div>
                    <dt>Waiting to be understood</dt>
                    <dd>{connection!.pendingMessages} messages</dd>
                  </div>
                )}
                {connection && (
                  <div>
                    <dt>Interpretation this month</dt>
                    <dd>
                      ${connection.monthlySpendUsd.toFixed(2)} of $
                      {connection.monthlyBudgetUsd.toFixed(2)}
                    </dd>
                  </div>
                )}
              </dl>
              {connection?.error && (
                <p className="personal-inline-error">{connection.error}</p>
              )}
              {connection?.warning && (
                <p className="connection-explainer">{connection.warning}</p>
              )}
              {connection?.processingStatus === 'paused_missing_key' && (
                <p className="connection-explainer">
                  Email capture is ready. Booking interpretation still needs to
                  be connected.
                </p>
              )}
              {connection?.processingStatus === 'paused_budget' && (
                <p className="connection-explainer">
                  Interpretation is paused at your monthly budget. Captured
                  email is waiting safely.
                </p>
              )}
              {Boolean(connection?.failedMessages) && (
                <div className="connection-explainer">
                  <p>
                    {connection!.failedMessages} email
                    {connection!.failedMessages === 1 ? '' : 's'} could not be
                    interpreted. Captured messages are saved.
                  </p>
                  <Button
                    className="quiet-action"
                    variant="ghost"
                    disabled={
                      busy || connection?.processingStatus === 'processing'
                    }
                    onClick={() =>
                      void act(async () => {
                        await api('gmail/retry-processing', 'POST', {});
                        setNotice(
                          'Retrying saved emails. No new Gmail check is needed.',
                        );
                      })
                    }
                  >
                    Retry interpretation
                  </Button>
                </div>
              )}
              {!connection?.configured && data && (
                <p className="connection-explainer">
                  Google connection setup is in progress.
                </p>
              )}
              <div className="personal-actions">
                {connected ? (
                  <>
                    <Button
                      className="primary-action"
                      disabled={busy || connection?.status === 'syncing'}
                      onClick={() =>
                        void act(async () => {
                          await api('gmail/sync', 'POST', {});
                          setNotice(
                            'Checking Gmail. Suggestions will appear in Review.',
                          );
                        })
                      }
                    >
                      <RefreshCw size={16} />
                      Check now
                    </Button>
                    <Button
                      className="quiet-action"
                      variant="ghost"
                      onClick={() => setModal('disconnect')}
                    >
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    className="primary-action"
                    disabled={busy || !connection?.configured}
                    onClick={connect}
                  >
                    <Mail size={16} />
                    {connection?.status === 'reconnect_required'
                      ? 'Reconnect Gmail'
                      : 'Connect Gmail'}
                  </Button>
                )}
              </div>
              <p className="connection-small">
                Gmail access cannot send, delete, or edit your email. Confirming
                a plan does not send an RSVP.
              </p>
              <DeliverySettings events={events} onEdit={event => { setActive(event); setModal('edit'); }} />
            </div>
          )}
          {modal === 'review' && (
            <div className="review-list">
              {proposals.length ? (
                proposals.map((item) => (
                  <article className="suggestion" key={item.id}>
                    <div className="suggestion-top">
                      <span className="source-tag">Gmail</span>
                      <span>
                        {item.action === 'cancel'
                          ? 'Cancellation to review'
                          : item.action === 'update'
                            ? 'Booking changed'
                            : item.attendance === 'invited' ||
                                item.attendance === 'unknown'
                              ? 'Are you going?'
                              : 'Ready to review'}
                      </span>
                    </div>
                    <h3>{item.event.title}</h3>
                    <p className="suggestion-date">{eventWhen(item.event)}</p>
                    <p className="proposal-reason">{item.reason}</p>
                    <details>
                      <summary>View evidence</summary>
                      {item.evidence.map((text, i) => (
                        <blockquote key={i}>{text}</blockquote>
                      ))}
                    </details>
                    {item.unresolvedFields.length > 0 && (
                      <p className="proposal-unresolved">
                        To check: {item.unresolvedFields.join(', ')}
                      </p>
                    )}
                    <div className="suggestion-actions">
                      <Button
                        disabled={busy}
                        className="primary-action"
                        onClick={() => {
                          setProposal(item);
                          setModal('proposal');
                        }}
                      >
                        {item.action === 'cancel'
                          ? 'Review cancellation'
                          : 'Review details'}
                        <ArrowUpRight size={15} />
                      </Button>
                      <Button
                        disabled={busy}
                        variant="ghost"
                        className="quiet-action"
                        onClick={() =>
                          void act(async () => {
                            await api(
                              `proposals/${item.id}/dismiss`,
                              'POST',
                              {},
                            );
                            setNotice('Suggestion dismissed.');
                          })
                        }
                      >
                        Dismiss
                      </Button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="review-empty">
                  <Check size={30} />
                  <h3>Nothing waiting on you.</h3>
                  <p>
                    {connected
                      ? 'New suggestions will appear after Gmail is checked.'
                      : 'Connect Gmail to bring your bookings into review.'}
                  </p>
                  {!connected && (
                    <Button
                      className="primary-action"
                      onClick={() => setModal('connections')}
                    >
                      Connect Gmail
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          {modal === 'proposal' && proposal && (
            <>
              <p className="proposal-reason">{proposal.reason}</p>
              <details>
                <summary>Source evidence</summary>
                {proposal.evidence.map((text, i) => (
                  <blockquote key={i}>{text}</blockquote>
                ))}
              </details>
              {proposal.action === 'cancel' ? (
                <div className="cancel-review">
                  <h3>{proposal.event.title}</h3>
                  <p>{eventWhen(proposal.event)}</p>
                  <p>
                    Remove this saved plan after reviewing the cancellation.
                    This does not contact the provider.
                  </p>
                  <Button
                    disabled={busy}
                    className="primary-action"
                    onClick={() =>
                      void act(async () => {
                        await api(`proposals/${proposal.id}/confirm`, 'POST', {
                          expectedRevision: proposal.targetRevision,
                        });
                        setModal('review');
                        setNotice('Cancellation saved.');
                      })
                    }
                  >
                    Confirm removal
                  </Button>
                </div>
              ) : (
                <EventForm
                  key={proposal.id}
                  initial={proposal.event}
                  busy={busy}
                  onSave={saveEvent}
                  label={
                    proposal.action === 'update'
                      ? 'Save this change'
                      : proposal.attendance === 'invited' ||
                          proposal.attendance === 'unknown'
                        ? 'I’m going — add to calendar'
                        : 'Add to calendar'
                  }
                />
              )}
            </>
          )}
          {modal === 'add' && (
            <EventForm
              initial={blank(selected)}
              busy={busy}
              onSave={saveEvent}
              label="Save plan"
            />
          )}
          {modal === 'edit' && active && (
            <EventForm
              key={`${active.id}:${active.revision}`}
              initial={active}
              busy={busy}
              onSave={saveEvent}
              label="Save changes"
            />
          )}
          {modal === 'event' && active && (
            <div className="booking-details">
              <p className="booking-when">{eventWhen(active)}</p>
              {(active.endTime || active.endTimeZone) && (
                <p className="booking-when">
                  End / arrival: {active.endDate || active.date} ·{' '}
                  {active.endTime || 'Time not supplied'}
                  {active.endTimeZone ? ` · ${active.endTimeZone}` : ''}
                </p>
              )}
              <p className="booking-location">
                <MapPin size={17} />
                {active.location || 'Location not supplied'}
              </p>
              <p className="booking-description">{active.detail}</p>
              {active.reference && (
                <button
                  className="booking-reference"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(active.reference!)
                      .then(() => setNotice('Reference copied.'))
                      .catch(() =>
                        setNotice(
                          'Copy unavailable. You can select the reference.',
                        ),
                      )
                  }
                >
                  <span>
                    <small>Booking reference</small>
                    <strong>{active.reference}</strong>
                  </span>
                  <Copy size={17} />
                </button>
              )}
              <div className="personal-actions">
                <Button
                  className="primary-action"
                  onClick={() => setModal('edit')}
                >
                  Edit plan
                </Button>
                <Button
                  variant="ghost"
                  className="quiet-action"
                  onClick={() => setModal('delete')}
                >
                  Remove
                </Button>
              </div>
              <p className="connection-small">
                Saved from {active.source}. Times remain local to the booking.
              </p>
            </div>
          )}
          {modal === 'delete' && active && (
            <div className="cancel-review">
              <h3>{active.title}</h3>
              <p>{eventWhen(active)}</p>
              <div className="personal-actions">
                <Button
                  className="primary-action"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api(`events/${active.id}`, 'DELETE', {
                        expectedRevision: active.revision,
                      });
                      setModal(null);
                      setNotice('Plan removed.');
                    })
                  }
                >
                  Remove from calendar
                </Button>
                <Button
                  variant="ghost"
                  className="quiet-action"
                  onClick={() => setModal('event')}
                >
                  Keep it
                </Button>
              </div>
            </div>
          )}
          {modal === 'disconnect' && (
            <div className="personal-actions">
              <Button
                disabled={busy}
                className="primary-action"
                onClick={() =>
                  void act(async () => {
                    const result = await api<{ warning?: string }>(
                      'gmail/disconnect',
                      'POST',
                      {},
                    );
                    setDisconnectWarning(result.warning || '');
                    setModal('connections');
                    setNotice('Gmail disconnected. Your saved plans remain.');
                  })
                }
              >
                Disconnect Gmail
              </Button>
              <Button
                className="quiet-action"
                variant="ghost"
                onClick={() => setModal('connections')}
              >
                Keep connected
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {notice && (
        <output className="notice personal-notice">
          <Check size={17} />
          {notice}
        </output>
      )}
    </div>
  );
}
