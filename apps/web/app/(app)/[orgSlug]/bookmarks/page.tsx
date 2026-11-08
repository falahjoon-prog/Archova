import type { Metadata } from 'next';
import { BookmarksScreen } from '@/features/bookmarks';

export const metadata: Metadata = { title: 'Bookmarks' };

export default function BookmarksPage() {
  return <BookmarksScreen />;
}
