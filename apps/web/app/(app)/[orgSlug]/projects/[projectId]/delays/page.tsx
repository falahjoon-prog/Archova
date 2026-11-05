import type { Metadata } from 'next';
import { DelayRegisterScreen } from '@/features/schedule';

export const metadata: Metadata = { title: 'Delay register' };

export default function DelaysPage() {
  return <DelayRegisterScreen />;
}
