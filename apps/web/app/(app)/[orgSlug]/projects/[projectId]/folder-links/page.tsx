import type { Metadata } from 'next';
import { FolderLinksScreen } from '@/features/folder-links';

export const metadata: Metadata = { title: 'SharePoint and Drive' };

export default function FolderLinksPage() {
  return <FolderLinksScreen />;
}
