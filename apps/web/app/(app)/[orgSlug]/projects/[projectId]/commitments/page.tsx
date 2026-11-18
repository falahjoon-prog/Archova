import type { Metadata } from 'next';
import { CommitmentsScreen } from '@/features/commitments';

export const metadata: Metadata = { title: 'Commitments' };

export default function CommitmentsPage() {
  return <CommitmentsScreen />;
}
