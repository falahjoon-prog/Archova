import type { Metadata } from 'next';
import { ImportsScreen } from '@/features/imports';

export const metadata: Metadata = { title: 'Imports' };

export default function ImportsPage() {
  return <ImportsScreen />;
}
