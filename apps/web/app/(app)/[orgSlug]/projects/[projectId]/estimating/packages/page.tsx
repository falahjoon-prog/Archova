import type { Metadata } from 'next';
import { PackageListScreen } from '@/features/estimating';

export const metadata: Metadata = { title: 'Tender packages' };

export default function TenderPackagesPage() {
  return <PackageListScreen />;
}
