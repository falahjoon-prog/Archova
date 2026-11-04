import type { Metadata } from 'next';
import { SwmsScreen } from '@/features/swms';

export const metadata: Metadata = { title: 'SWMS' };

export default function SwmsPage() {
  return <SwmsScreen />;
}
