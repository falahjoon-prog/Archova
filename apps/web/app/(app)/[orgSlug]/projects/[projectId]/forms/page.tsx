import type { Metadata } from 'next';
import { FormsScreen } from '@/features/forms';

export const metadata: Metadata = { title: 'Forms' };

export default function FormsPage() {
  return <FormsScreen />;
}
