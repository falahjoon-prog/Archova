import { useLocalSearchParams } from 'expo-router';
import { DrawingRegisterScreen } from '../../../../features/drawings';

export default function DrawingsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <DrawingRegisterScreen projectId={projectId} />;
}
