import { useLocalSearchParams } from 'expo-router';
import { TimesheetsScreen } from '../../../../features/timesheets';

export default function TimesheetsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <TimesheetsScreen projectId={projectId} />;
}
