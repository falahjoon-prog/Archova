import { useLocalSearchParams } from 'expo-router';
import { SiteSignInScreen } from '../../../../features/attendance';

export default function SiteSignInRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <SiteSignInScreen projectId={projectId} />;
}
