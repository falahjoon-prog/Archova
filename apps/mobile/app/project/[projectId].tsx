import { useLocalSearchParams } from 'expo-router';
import { ProjectScreen } from '../../features/platform';

export default function ProjectRoute() {
  const { projectId, orgId } = useLocalSearchParams<{ projectId: string; orgId?: string }>();
  return <ProjectScreen projectId={projectId} orgId={orgId} />;
}
