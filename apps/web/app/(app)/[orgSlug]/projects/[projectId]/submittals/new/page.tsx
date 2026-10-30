import type { Metadata } from 'next';
import { SubmittalNewScreen } from '@/features/submittals';

export const metadata: Metadata = { title: 'Add submittal' };

export default function NewSubmittalPage() {
  return <SubmittalNewScreen />;
}
