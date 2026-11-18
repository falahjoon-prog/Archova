import type { Metadata } from 'next';
import { TmTicketsScreen } from '@/features/tm-tickets';

export const metadata: Metadata = { title: 'T&M tickets' };

export default function TmTicketsPage() {
  return <TmTicketsScreen />;
}
