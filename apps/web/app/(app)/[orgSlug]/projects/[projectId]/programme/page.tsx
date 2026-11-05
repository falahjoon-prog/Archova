import type { Metadata } from 'next';
import { ProgrammeScreen } from '@/features/schedule';

export const metadata: Metadata = { title: 'Programme' };

export default function ProgrammePage() {
  return <ProgrammeScreen />;
}
