import type { Metadata } from 'next';
import { SafetyScorecardsScreen } from '@/features/safety-scorecards';

export const metadata: Metadata = { title: 'Safety scorecards' };

export default function SafetyScorecardsPage() {
  return <SafetyScorecardsScreen />;
}
