import { useLocalSearchParams } from 'expo-router';
import { TimesheetScreen } from '../../../../features/timesheets';

export default function TimesheetsDetailRoute() {
  const { projectId, timesheetId } = useLocalSearchParams<{
    projectId: string;
    timesheetId: string;
  }>();
  return <TimesheetScreen projectId={projectId} timesheetId={timesheetId} />;
}
