import { useLocalSearchParams } from 'expo-router';
import { SpecBookScreen } from '../../../../features/specifications';

export default function SpecificationsDetailRoute() {
  const { projectId, bookId } = useLocalSearchParams<{ projectId: string; bookId: string }>();
  return <SpecBookScreen projectId={projectId} bookId={bookId} />;
}
