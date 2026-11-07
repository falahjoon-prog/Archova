import type { Metadata } from 'next';
import { PhotosScreen } from '@/features/photos';

export const metadata: Metadata = { title: 'Photos' };

export default function PhotosPage() {
  return <PhotosScreen />;
}
