import type { Metadata } from 'next';
import { BrandingScreen } from '@/features/branding';

export const metadata: Metadata = { title: 'Branding' };

export default function BrandingPage() {
  return <BrandingScreen />;
}
