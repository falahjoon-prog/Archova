import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { listSwms } from '../commands';
import { swmsSubtitle } from '../format';

type Filter = 'all' | 'accepted' | 'expired';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'expired', label: 'Expired' },
];

export function SwmsRegisterScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useQuery({
    queryKey: ['swms', orgId, projectId, 'list', filter],
    queryFn: () =>
      listSwms(
        api,
        { orgId: orgId!, projectId },
        { status: filter === 'accepted' ? 'accepted' : undefined, expired: filter === 'expired' },
      ),
    enabled: orgId !== null,
  });
  if (!orgId) {
    return (
      <Screen title="SWMS">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  return (
    <Screen title="SWMS">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] }}>
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            label={f.label}
            variant={filter === f.id ? 'primary' : 'secondary'}
            onPress={() => setFilter(f.id)}
          />
        ))}
      </View>
      {rows.isPending ? <StateMessage loading message="Loading SWMS" /> : null}
      {rows.isError ? (
        <StateMessage
          tone="danger"
          message="Could not load the SWMS register. Check your connection."
          onRetry={() => void rows.refetch()}
        />
      ) : null}
      {rows.data && rows.data.length === 0 ? <StateMessage message="No SWMS to show." /> : null}
      {rows.data?.map((s) => (
        <ListItem
          key={s.id}
          title={s.title}
          subtitle={swmsSubtitle(s)}
          onPress={() => router.push(mobileRoutes.swms(projectId, s.id))}
        />
      ))}
    </Screen>
  );
}
