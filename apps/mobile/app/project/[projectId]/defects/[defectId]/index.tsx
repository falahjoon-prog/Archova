import { useLocalSearchParams } from 'expo-router';
import { DefectDetailScreen } from '../../../../../features/defects';
import { useMyProjectCompany } from '../../../../../shared';

export default function DefectRoute() {
  const { projectId, defectId } = useLocalSearchParams<{ projectId: string; defectId: string }>();
  const myCompanyId = useMyProjectCompany(projectId);
  return <DefectDetailScreen projectId={projectId} defectId={defectId} myCompanyId={myCompanyId} />;
}
