import type { Metadata } from 'next';
import { AnnouncementsScreen } from '@/features/announcements';

export const metadata: Metadata = { title: 'Announcements' };

export default function AnnouncementsPage() {
  return <AnnouncementsScreen />;
}
