export type EventKind =
  | 'food'
  | 'travel'
  | 'stay'
  | 'social'
  | 'appointment'
  | 'other';
export type EventFields = {
  title: string;
  date?: string;
  time?: string;
  endDate?: string;
  endTime?: string;
  timeZone?: string;
  endTimeZone?: string;
  kind: EventKind;
  location: string;
  detail: string;
  reference?: string;
  reminderMinutes?: number | null;
};
export type CalendarEvent = EventFields & {
  id: string;
  date: string;
  source: string;
  revision: number;
};
export type Proposal = {
  id: string;
  action: 'create' | 'update' | 'cancel';
  targetEventId?: string;
  targetRevision?: number;
  event: EventFields;
  attendance: 'confirmed' | 'invited' | 'unknown' | 'declined';
  reason: string;
  evidence: string[];
  unresolvedFields: string[];
  revision: number;
};
export type Connection = {
  status:
    | 'not_configured'
    | 'disconnected'
    | 'connected'
    | 'syncing'
    | 'reconnect_required';
  email: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  pendingMessages: number;
  capturedMessages: number;
  filteredMessages: number;
  failedMessages: number;
  processingStatus:
    | 'idle'
    | 'processing'
    | 'paused_missing_key'
    | 'paused_budget'
    | 'error';
  error: string | null;
  warning: string | null;
  monthlySpendUsd: number;
  monthlyBudgetUsd: number;
  configured: boolean;
};
export type CalendarState = {
  events: CalendarEvent[];
  proposals: Proposal[];
  connection: Connection;
};
