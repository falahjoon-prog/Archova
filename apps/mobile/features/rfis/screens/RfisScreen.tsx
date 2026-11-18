import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { useMe } from '../../platform';
import { listRfis } from '../commands';
import { rfiSubtitle, type RfiFilter } from '../format';

const FILTERS: { id: RfiFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Waiting on me' },
  { id: 'overdue', label: 'Overdue' },
];

export function RfisScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const meId = useMe().data?.user.id;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RfiFilter>('all');
  const rows = useQuery({
    queryKey: ['rfis', orgId, projectId, 'list', q.trim(), filter, meId],
    queryFn: () =>
      listRfis(
        api,
        { orgId: orgId!, projectId },
        { q, overdue: filter === 'overdue', mineUserId: filter === 'mine' ? meId : undefined },
      ),
    enabled: orgId !== null && (filter !== 'mine' || Boolean(meId)),
  });
  if (!orgId) {
    return (
      <Screen title="RFIs">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  return (
    <Screen title="RFIs">
      <TextField label="Search RFIs" value={q} onChangeText={setQ} />
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
      {rows.isPending ? <StateMessage loading message="Loading RFIs" /> : null}
      {rows.isError ? (
        <StateMessage
          tone="danger"
          message="Could not load RFIs. Check your connection."
          onRetry={() => void rows.refetch()}
        />
      ) : null}
      {rows.data && rows.data.length === 0 ? <StateMessage message="No RFIs to show." /> : null}
      {rows.data?.map((r) => (
        <ListItem
          key={r.id}
          title={r.subject}
          subtitle={rfiSubtitle(r)}
          onPress={() => router.push(mobileRoutes.rfi(projectId, r.id))}
        />
      ))}
    </Screen>
  );
}
