import type { Metadata } from 'next';
import { CostLibraryScreen } from '@/features/estimating';

export const metadata: Metadata = { title: 'Cost library' };

export default function CostLibraryPage() {
  return <CostLibraryScreen />;
}
