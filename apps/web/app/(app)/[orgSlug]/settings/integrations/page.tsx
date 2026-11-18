import type { Metadata } from 'next';
import { MarketplaceScreen } from '@/features/marketplace';

export const metadata: Metadata = { title: 'Integrations' };

export default function IntegrationsPage() {
  return <MarketplaceScreen />;
}
