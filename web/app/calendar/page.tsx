import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isOwner } from '@/lib/access';
import { authenticationConfigured, getCalendarSettings } from '@/lib/settings';
import CalendarClient from './calendar-client';
import './calendar.css';
export const metadata = { title: 'My Calendar', description: 'Your plans, in one place.' };
export const dynamic = 'force-dynamic';
export default async function CalendarPage() {
  if (!authenticationConfigured()) redirect('/sign-in');
  const session = await auth();
  if (!isOwner(session, getCalendarSettings())) redirect('/sign-in');
  return <CalendarClient />;
}
