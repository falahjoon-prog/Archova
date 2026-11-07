import type { Metadata } from 'next';
import { InboxScreen } from '@/features/notifications';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  return <InboxScreen />;
}
