import type { Metadata } from 'next';
import { AppsScreen } from '@/features/partner-apps';

export const metadata: Metadata = { title: 'Apps' };

export default function AppsPage() {
  return <AppsScreen />;
}
