import type { Metadata } from 'next';
import { HandoverScreen } from '@/features/handover';

export const metadata: Metadata = { title: 'Handover' };

export default function HandoverPage() {
  return <HandoverScreen />;
}
