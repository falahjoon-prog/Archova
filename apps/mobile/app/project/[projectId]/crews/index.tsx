import { useLocalSearchParams } from 'expo-router';
import { CrewsScreen } from '../../../../features/crews';

export default function CrewsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <CrewsScreen projectId={projectId} />;
}
