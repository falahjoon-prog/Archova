import type { Metadata } from 'next';
import { RfiNewScreen } from '@/features/rfis';

export const metadata: Metadata = { title: 'New RFI' };

export default function NewRfiPage() {
  return <RfiNewScreen />;
}
