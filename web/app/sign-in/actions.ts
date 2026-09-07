'use server';
import { signIn } from '@/auth';
export async function signInToCalendar() { await signIn('google', { redirectTo: '/calendar' }); }
