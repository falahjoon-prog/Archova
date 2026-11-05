import { useLocalSearchParams } from 'expo-router';
import { OwnerPortalScreen } from '../../../../features/owner-portal';

export default function OwnerPortalRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <OwnerPortalScreen projectId={projectId} />;
}
