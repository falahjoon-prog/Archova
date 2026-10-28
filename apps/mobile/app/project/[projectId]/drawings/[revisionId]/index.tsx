import { useLocalSearchParams } from 'expo-router';
import { DrawingViewerScreen } from '../../../../../features/drawings';

export default function DrawingViewerRoute() {
  const { projectId, revisionId } = useLocalSearchParams<{
    projectId: string;
    revisionId: string;
  }>();
  return <DrawingViewerScreen projectId={projectId} revisionId={revisionId} />;
}
