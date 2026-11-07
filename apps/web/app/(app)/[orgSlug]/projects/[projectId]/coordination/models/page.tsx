import type { Metadata } from 'next';
import { ModelViewerScreen } from '@/features/coordination';

export const metadata: Metadata = { title: 'Model viewer' };

export default function ModelViewerPage() {
  return <ModelViewerScreen />;
}
