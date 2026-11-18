// Machines allocated to this project, with the rest of the fleet below. Daily rates are never shown on the phone.
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { localDateOf } from '@archova/time';
import { ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { deviceTimeZone } from '../../../lib/capture/capture';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { listAssets, listProjectAllocations } from '../commands';
import { allocationRange, assetSubtitle } from '../format';

export function EquipmentScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const today = localDateOf(new Date(), deviceTimeZone() ?? 'UTC');
  const assets = useQuery({
    queryKey: ['equipment', orgId, 'assets'],
    queryFn: () => listAssets(api, orgId!),
    enabled: orgId !== null,
  });
  const allocations = useQuery({
    queryKey: ['equipment', orgId, projectId, 'allocations', today],
    queryFn: () => listProjectAllocations(api, orgId!, projectId, today),
    enabled: orgId !== null,
  });
  if (!orgId) {
    return (
      <Screen title="Equipment">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (assets.isPending || allocations.isPending) {
    return (
      <Screen title="Equipment">
        <StateMessage loading message="Loading equipment" />
      </Screen>
    );
  }
  if (assets.isError || allocations.isError) {
    return (
      <Screen title="Equipment">
        <StateMessage
          tone="danger"
          message="Could not load equipment."
          onRetry={() => {
            void assets.refetch();
            void allocations.refetch();
          }}
        />
      </Screen>
    );
  }
  const byId = new Map(assets.data.map((a) => [a.id, a]));
  const here = allocations.data
    .filter((a) => a.status === 'active')
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const hereIds = new Set(here.map((a) => a.assetId));
  const others = assets.data.filter((a) => !hereIds.has(a.id) && a.status !== 'retired');
  const heading = { color: t.color.textSecondary, fontSize: t.font.size.sm };
  return (
    <Screen title="Equipment">
      <Text style={heading}>On this project</Text>
      {here.length === 0 ? <StateMessage message="No machines allocated here." /> : null}
      {here.map((al) => {
        const a = byId.get(al.assetId);
        return (
          <View key={al.id} style={{ gap: t.space[1] }}>
            <ListItem
              title={a ? `${a.name} (${a.assetNumber})` : 'Machine'}
              subtitle={[a ? assetSubtitle(a) : null, allocationRange(al.startsOn, al.endsOn)]
                .filter(Boolean)
                .join(', ')}
            />
            {al.note ? <Text style={{ color: t.color.textSecondary }}>{al.note}</Text> : null}
          </View>
        );
      })}
      {others.length > 0 ? <Text style={heading}>Rest of the fleet</Text> : null}
      {others.map((a) => (
        <ListItem key={a.id} title={`${a.name} (${a.assetNumber})`} subtitle={assetSubtitle(a)} />
      ))}
    </Screen>
  );
}
