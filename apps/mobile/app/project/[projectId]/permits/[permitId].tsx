import { useLocalSearchParams } from 'expo-router';
import { PermitScreen } from '../../../../features/permits';

export default function PermitRoute() {
  const { projectId, permitId } = useLocalSearchParams<{ projectId: string; permitId: string }>();
  return <PermitScreen projectId={projectId} permitId={permitId} />;
}
