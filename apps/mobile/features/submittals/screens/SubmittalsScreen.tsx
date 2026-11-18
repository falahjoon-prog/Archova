import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen, TextField } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { listSubmittals } from '../commands';
import { submittalSubtitle } from '../format';

export function SubmittalsScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const [q, setQ] = useState('');
  const rows = useQuery({
    queryKey: ['submittals', orgId, projectId, 'list', q.trim()],
    queryFn: () => listSubmittals(api, { orgId: orgId!, projectId }, { q }),
    enabled: orgId !== null,
  });
  if (!orgId) {
    return (
      <Screen title="Submittals">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  return (
    <Screen title="Submittals">
      <TextField label="Search submittals" value={q} onChangeText={setQ} />
      {rows.isPending ? <StateMessage loading message="Loading submittals" /> : null}
      {rows.isError ? (
        <StateMessage
          tone="danger"
          message="Could not load submittals. Check your connection."
          onRetry={() => void rows.refetch()}
        />
      ) : null}
      {rows.data && rows.data.length === 0 ? (
        <StateMessage message="No submittals to show." />
      ) : null}
      {rows.data?.map((s) => (
        <ListItem
          key={s.id}
          title={s.title}
          subtitle={submittalSubtitle(s)}
          onPress={() => router.push(mobileRoutes.submittal(projectId, s.id))}
        />
      ))}
    </Screen>
  );
}
