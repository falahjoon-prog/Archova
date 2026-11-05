import type { Metadata } from 'next';
import { FoldersScreen } from '@/features/folder-links';

export const metadata: Metadata = { title: 'SharePoint and Drive' };

export default function FoldersPage() {
  return <FoldersScreen />;
}
