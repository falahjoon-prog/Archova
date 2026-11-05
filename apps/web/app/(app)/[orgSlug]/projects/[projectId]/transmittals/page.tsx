import type { Metadata } from 'next';
import { TransmittalListScreen } from '@/features/transmittals';

export const metadata: Metadata = { title: 'Transmittals' };

export default function TransmittalsPage() {
  return <TransmittalListScreen />;
}
