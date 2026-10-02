import type { Metadata } from 'next';
import { DrawingRegisterScreen } from '@/features/drawings';

export const metadata: Metadata = { title: 'Drawings' };

export default function DrawingsPage() {
  return <DrawingRegisterScreen />;
}
