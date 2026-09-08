import type { Metadata } from 'next';
import DemoClient from './demo-client';
import '../calendar/calendar.css';
import './demo.css';

export const metadata: Metadata = { title: 'Calendar — fictional demo', description: 'Bookings added automatically, invitations clearly labelled. An interactive calendar with fictional data.', robots: { index: false, follow: false } };
export default function DemoPage() { return <DemoClient />; }
