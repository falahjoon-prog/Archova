import type { Metadata } from 'next';
import { SupportAccessScreen } from '@/features/support-access';

export const metadata: Metadata = { title: 'Support access' };

export default function SupportAccessPage() {
  return <SupportAccessScreen />;
}
