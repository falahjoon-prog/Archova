import type { Metadata } from 'next';
import { ItpScreen } from '@/features/itp';

export const metadata: Metadata = { title: 'Inspection and test plans' };

export default function ItpPage() {
  return <ItpScreen />;
}
