import type { Metadata } from 'next';
import { ClaimsRegisterScreen } from '@/features/claims';

export const metadata: Metadata = { title: 'Payment claims' };

export default function PaymentClaimsPage() {
  return <ClaimsRegisterScreen />;
}
