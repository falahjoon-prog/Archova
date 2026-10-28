import { useLocalSearchParams } from 'expo-router';
import { InductionScreen } from '../../../../features/inductions';

export default function InductionRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <InductionScreen projectId={projectId} />;
}
