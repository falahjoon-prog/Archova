import type { Metadata } from 'next';
import { CoordinationScreen } from '@/features/coordination';

export const metadata: Metadata = { title: 'Coordination' };

export default function CoordinationPage() {
  return <CoordinationScreen />;
}
