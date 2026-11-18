import { useLocalSearchParams } from 'expo-router';
import { SwmsScreen } from '../../../../features/swms';

export default function SwmsRoute() {
  const { projectId, swmsId } = useLocalSearchParams<{ projectId: string; swmsId: string }>();
  return <SwmsScreen projectId={projectId} swmsId={swmsId} />;
}
