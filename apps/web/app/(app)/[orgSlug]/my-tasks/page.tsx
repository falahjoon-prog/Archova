import type { Metadata } from 'next';
import { MyTasksScreen } from '@/features/tasks';

export const metadata: Metadata = { title: 'My tasks' };

export default function MyTasksPage() {
  return <MyTasksScreen />;
}
