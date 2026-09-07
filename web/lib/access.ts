export type OwnerSession = { user?: { id?: string; email?: string | null; ownerVerified?: boolean } } | null;
export type CalendarSettings = {
  CALENDAR_OWNER_EMAIL?: string;
  CALENDAR_OWNER_ID?: string;
  CALENDAR_API_BASE_URL?: string;
  CALENDAR_SERVICE_TOKEN?: string;
  CALENDAR_APP_ORIGIN?: string;
};

export function appOrigin(value?: string): string {
  if (!value) throw new Error('Calendar origin is not configured');
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Calendar origin must be an HTTPS origin');
  return url.origin;
}

export function allowedGoogleProfile(provider: string | undefined, profile: { email?: unknown; email_verified?: unknown } | undefined, ownerEmail?: string): boolean {
  return Boolean(ownerEmail && provider === 'google' && profile?.email_verified === true && typeof profile.email === 'string' && profile.email.toLowerCase() === ownerEmail.toLowerCase());
}

export function isOwner(session: OwnerSession, settings: CalendarSettings): boolean {
  return Boolean(settings.CALENDAR_OWNER_EMAIL && settings.CALENDAR_OWNER_ID && session?.user?.ownerVerified === true && session.user.id === settings.CALENDAR_OWNER_ID && session.user.email?.toLowerCase() === settings.CALENDAR_OWNER_EMAIL.toLowerCase());
}
