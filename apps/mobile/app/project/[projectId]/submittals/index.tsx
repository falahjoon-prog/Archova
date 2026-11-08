import { useLocalSearchParams } from 'expo-router';
import { SubmittalsScreen } from '../../../../features/submittals';

export default function SubmittalsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <SubmittalsScreen projectId={projectId} />;
}
