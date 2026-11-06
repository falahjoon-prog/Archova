import type { Metadata } from 'next';
import { MyWorkScreen } from '@/features/reporting';

export const metadata: Metadata = { title: 'My Work' };

export default function MyWorkPage() {
  return <MyWorkScreen />;
}
