import type { Metadata } from 'next';
import { EvidencePackScreen } from '@/features/safety-evidence';

export const metadata: Metadata = { title: 'Safety evidence pack' };

export default function SafetyEvidencePackPage() {
  return <EvidencePackScreen />;
}
