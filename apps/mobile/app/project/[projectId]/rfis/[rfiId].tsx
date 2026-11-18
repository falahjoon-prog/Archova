import { useLocalSearchParams } from 'expo-router';
import { RfiScreen } from '../../../../features/rfis';

export default function RfiRoute() {
  const { projectId, rfiId } = useLocalSearchParams<{ projectId: string; rfiId: string }>();
  return <RfiScreen projectId={projectId} rfiId={rfiId} />;
}
