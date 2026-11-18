import { useLocalSearchParams } from 'expo-router';
import { SwmsRegisterScreen } from '../../../../features/swms';

export default function SwmsRegisterRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <SwmsRegisterScreen projectId={projectId} />;
}
