import type { Metadata } from 'next';
import { SiteCaptureScreen } from '@/features/site-capture';

export const metadata: Metadata = { title: 'Site capture' };

export default function SiteCapturePage() {
  return <SiteCaptureScreen />;
}
