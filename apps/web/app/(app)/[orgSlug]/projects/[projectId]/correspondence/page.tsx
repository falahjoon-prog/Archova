import type { Metadata } from 'next';
import { CorrespondenceListScreen } from '@/features/correspondence';

export const metadata: Metadata = { title: 'Correspondence' };

export default function CorrespondencePage() {
  return <CorrespondenceListScreen />;
}
