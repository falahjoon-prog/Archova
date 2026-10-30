import type { Metadata } from 'next';
import { SubmittalListScreen } from '@/features/submittals';

export const metadata: Metadata = { title: 'Submittals' };

export default function SubmittalsPage() {
  return <SubmittalListScreen />;
}
