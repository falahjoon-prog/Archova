import type { Metadata } from 'next';
import { DiaryDayScreen } from '@/features/diary';

export const metadata: Metadata = { title: 'Site diary' };

/** "Diary" opens today's entry with no extra taps (DIA-AC1). */
export default function DiaryTodayPage() {
  return <DiaryDayScreen />;
}
