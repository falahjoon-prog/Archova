import { useLocalSearchParams } from 'expo-router';
import { SubmittalScreen } from '../../../../features/submittals';

export default function SubmittalsDetailRoute() {
  const { projectId, submittalId } = useLocalSearchParams<{
    projectId: string;
    submittalId: string;
  }>();
  return <SubmittalScreen projectId={projectId} submittalId={submittalId} />;
}
