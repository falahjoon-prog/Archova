import type { Metadata } from 'next';
import { EnvironmentScreen } from '@/features/environment';

export const metadata: Metadata = { title: 'Environmental management' };

export default function EnvironmentPage() {
  return <EnvironmentScreen />;
}
