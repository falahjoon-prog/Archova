import type { Metadata } from 'next';
import { RfiListScreen } from '@/features/rfis';

export const metadata: Metadata = { title: 'RFIs' };

export default function RfisPage() {
  return <RfiListScreen />;
}
