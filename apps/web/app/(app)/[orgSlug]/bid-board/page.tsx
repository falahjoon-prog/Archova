import type { Metadata } from 'next';
import { BidBoardScreen } from '@/features/bid-board';

export const metadata: Metadata = { title: 'Bid board' };

export default function BidBoardPage() {
  return <BidBoardScreen />;
}
