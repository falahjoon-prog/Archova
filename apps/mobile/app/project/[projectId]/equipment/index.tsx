import { useLocalSearchParams } from 'expo-router';
import { EquipmentScreen } from '../../../../features/equipment';

export default function EquipmentRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <EquipmentScreen projectId={projectId} />;
}
