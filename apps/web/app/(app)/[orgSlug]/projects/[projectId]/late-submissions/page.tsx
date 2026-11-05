import type { Metadata } from 'next';
import { LateSubmissionsScreen } from '@/features/late-submissions';

export const metadata: Metadata = { title: 'Late submissions' };

export default function LateSubmissionsPage() {
  return <LateSubmissionsScreen />;
}
