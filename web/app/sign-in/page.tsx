import { redirect } from 'next/navigation';
import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { auth } from '@/auth';
import { isOwner } from '@/lib/access';
import { authenticationConfigured, getCalendarSettings } from '@/lib/settings';
import { signInToCalendar } from './actions';
import './sign-in.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in — My Calendar' };
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const configured = authenticationConfigured();
  const session = configured ? await auth() : null;
  if (isOwner(session, getCalendarSettings())) redirect('/calendar');
  const { error } = await searchParams;
  return <main className="sign-in-page"><a className="sign-in-wordmark" href="/">calendar<span>.</span></a><section className="sign-in-card"><CalendarDays size={26} strokeWidth={1.4} /><p className="sign-in-eyebrow">A LITTLE MORE ROOM FOR LIFE</p><h1>Your plans,<br />in one place.</h1><p className="sign-in-copy">A quiet space for the things you’re looking forward to.</p>{error && <p className="sign-in-error" role="alert">{error === 'AccessDenied' ? 'This is a private calendar. Sign in with its owner’s Google account.' : 'Sign-in could not complete. Please try again.'}</p>}{configured ? <form action={signInToCalendar}><button type="submit" className="sign-in-button">Continue with Google <ArrowUpRight size={17} /></button></form> : <p className="sign-in-note" role="status">Your private calendar is being set up. Sign-in will be available shortly.</p>}<p className="sign-in-note">Sign-in verifies your identity. You can connect Gmail separately inside your calendar. <a href="/privacy">Privacy</a></p></section><a className="sign-in-studies" href="/designs">Explore the design studies <ArrowUpRight size={13} /></a></main>;
}
