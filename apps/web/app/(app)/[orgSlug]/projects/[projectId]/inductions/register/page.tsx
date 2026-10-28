import type { Metadata } from 'next';
import { InductionRegisterScreen } from '@/features/inductions';

export const metadata: Metadata = { title: 'Induction register' };

export default function InductionRegisterPage() {
  return <InductionRegisterScreen />;
}
