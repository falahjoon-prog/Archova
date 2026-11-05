import { useLocalSearchParams } from 'expo-router';
import { InspectionScreen } from '../../../../../features/inspections';

export default function InspectionRoute() {
  const { inspectionId } = useLocalSearchParams<{ inspectionId: string }>();
  return <InspectionScreen inspectionId={inspectionId} />;
}
