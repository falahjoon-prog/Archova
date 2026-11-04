import type { Metadata } from 'next';
import { WalletScreen } from '@/features/wallet';

export const metadata: Metadata = { title: 'Compliance wallet' };

export default function WalletPage() {
  return <WalletScreen />;
}
