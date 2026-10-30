import type { Metadata } from 'next';
import { CorrespondenceNewScreen } from '@/features/correspondence';

export const metadata: Metadata = { title: 'New correspondence' };

export default function NewCorrespondencePage() {
  return <CorrespondenceNewScreen />;
}
