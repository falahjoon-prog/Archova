import { useLocalSearchParams } from 'expo-router';
import { QuotePackageScreen } from '../../../../features/bid-board';

export default function TenderRoute() {
  const { projectId, packageId } = useLocalSearchParams<{ projectId: string; packageId: string }>();
  return <QuotePackageScreen projectId={projectId} packageId={packageId} />;
}
