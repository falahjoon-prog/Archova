import type { Metadata } from 'next';
import { ConversationsScreen } from '@/features/conversations';

export const metadata: Metadata = { title: 'Conversations' };

export default function ConversationsPage() {
  return <ConversationsScreen />;
}
