import { useLocalSearchParams } from 'expo-router';
import { PermitsScreen } from '../../../../features/permits';

export default function PermitsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <PermitsScreen projectId={projectId} />;
}
