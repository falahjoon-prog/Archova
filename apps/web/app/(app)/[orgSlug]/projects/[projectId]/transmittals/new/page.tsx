import type { Metadata } from 'next';
import { TransmittalNewScreen } from '@/features/transmittals';

export const metadata: Metadata = { title: 'New transmittal' };

export default function NewTransmittalPage() {
  return <TransmittalNewScreen />;
}
