import { useLocalSearchParams } from 'expo-router';
import { DeliveriesScreen } from '../../../../features/deliveries';

export default function DeliveriesRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <DeliveriesScreen projectId={projectId} />;
}
