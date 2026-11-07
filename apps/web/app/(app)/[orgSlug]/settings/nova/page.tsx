import type { Metadata } from 'next';
import { NovaSettingsScreen } from '@/features/nova-settings';

export const metadata: Metadata = { title: 'Nova settings' };

export default function NovaSettingsPage() {
  return <NovaSettingsScreen />;
}
