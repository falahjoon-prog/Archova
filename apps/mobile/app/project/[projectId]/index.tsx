import { Stack, useLocalSearchParams } from 'expo-router';
import { AskNovaButton } from '../../../features/assistant';
import { ProjectScreen } from '../../../features/platform';

export default function ProjectRoute() {
  const { projectId, orgId } = useLocalSearchParams<{ projectId: string; orgId?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerRight: () => <AskNovaButton projectId={projectId} /> }} />
      <ProjectScreen projectId={projectId} orgId={orgId} />
    </>
  );
}
