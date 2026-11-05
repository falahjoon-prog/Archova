import type { Metadata } from 'next';
import { PortfolioScreen } from '@/features/reporting';

export const metadata: Metadata = { title: 'Portfolio' };

export default function PortfolioPage() {
  return <PortfolioScreen />;
}
