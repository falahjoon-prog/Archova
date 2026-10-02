import type { Metadata } from 'next';
import { DrawingUploadScreen } from '@/features/drawings';

export const metadata: Metadata = { title: 'Upload drawings' };

export default function UploadDrawingsPage() {
  return <DrawingUploadScreen />;
}
