import type { Metadata } from 'next';
import { TimesheetsScreen } from '@/features/timesheets';

export const metadata: Metadata = { title: 'Timesheets' };

export default function TimesheetsPage() {
  return <TimesheetsScreen />;
}
