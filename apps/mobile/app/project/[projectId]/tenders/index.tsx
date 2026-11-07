import { useLocalSearchParams } from 'expo-router';
import { ProjectPackagesScreen } from '../../../../features/bid-board';

export default function TendersRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <ProjectPackagesScreen projectId={projectId} />;
}
