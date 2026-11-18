import type { Metadata } from 'next';
import { EotScreen } from '@/features/schedule';

export const metadata: Metadata = { title: 'EOT claims' };

export default function EotPage() {
  return <EotScreen />;
}
