import { useLocalSearchParams } from 'expo-router';
import { IncidentReportScreen } from '../../../../features/incidents';

export default function IncidentsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  return <IncidentReportScreen projectId={projectId} />;
}
