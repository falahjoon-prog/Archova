import { useLocalSearchParams } from 'expo-router';
import { NewDefectScreen, parsePlacement } from '../../../../features/defects';

export default function NewDefectRoute() {
  const params = useLocalSearchParams<{
    projectId: string;
    sheetId?: string;
    drawingRevisionId?: string;
    pinX?: string;
    pinY?: string;
  }>();
  return <NewDefectScreen projectId={params.projectId} placement={parsePlacement(params)} />;
}
