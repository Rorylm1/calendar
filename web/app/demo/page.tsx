import type { Metadata } from 'next';
import DemoClient from './demo-client';
import '../calendar/calendar.css';
import './demo.css';

export const metadata: Metadata = { title: 'Calendar — fictional demo', description: 'Try a message, review a suggestion, make it a plan. An interactive calendar with fictional data.', robots: { index: false, follow: false } };
export default function DemoPage() { return <DemoClient />; }
