import type { Metadata } from 'next';
import { DiaryDayScreen } from '@/features/diary';

export const metadata: Metadata = { title: 'Site diary' };

export default async function DiaryDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return <DiaryDayScreen date={date} />;
}
