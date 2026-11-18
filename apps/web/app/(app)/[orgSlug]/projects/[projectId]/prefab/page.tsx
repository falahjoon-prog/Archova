import type { Metadata } from 'next';
import { PrefabScreen } from '@/features/prefab';

export const metadata: Metadata = { title: 'Prefab and modular' };

export default function PrefabPage() {
  return <PrefabScreen />;
}
