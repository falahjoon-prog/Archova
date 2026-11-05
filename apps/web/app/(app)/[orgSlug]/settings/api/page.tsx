import type { Metadata } from 'next';
import { ApiAccessScreen } from '@/features/api-access';

export const metadata: Metadata = { title: 'API access' };

export default function ApiAccessPage() {
  return <ApiAccessScreen />;
}
