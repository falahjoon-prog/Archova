import type { Metadata } from 'next';
import { PrequalScreen } from '@/features/prequalification';

export const metadata: Metadata = { title: 'Prequalification' };

export default function PrequalificationPage() {
  return <PrequalScreen />;
}
