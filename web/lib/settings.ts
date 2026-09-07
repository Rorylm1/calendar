import 'server-only';
import { appOrigin, type CalendarSettings } from './access';
export const getCalendarSettings = (): CalendarSettings => ({
  CALENDAR_OWNER_EMAIL: process.env.CALENDAR_OWNER_EMAIL,
  CALENDAR_OWNER_ID: process.env.CALENDAR_OWNER_ID,
  CALENDAR_API_BASE_URL: process.env.CALENDAR_API_BASE_URL,
  CALENDAR_SERVICE_TOKEN: process.env.CALENDAR_SERVICE_TOKEN,
  CALENDAR_APP_ORIGIN: process.env.CALENDAR_APP_ORIGIN,
});
export function authenticationConfigured(): boolean {
  try {
    return Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32 && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.CALENDAR_OWNER_EMAIL && process.env.CALENDAR_OWNER_ID && appOrigin(process.env.AUTH_URL) === appOrigin(process.env.CALENDAR_APP_ORIGIN));
  } catch { return false; }
}
