// The permits register on the phone: what needs attention first, then every permit. Online only.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { listPermitFlags, listPermits } from '../commands';
import { permitSubtitle } from '../format';

export function PermitsScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const target = orgId ? { orgId, projectId } : null;
  const flags = useQuery({
    queryKey: ['permits', orgId, projectId, 'flags'],
    queryFn: () => listPermitFlags(api, target!),
    enabled: target !== null,
  });
  const permits = useQuery({
    queryKey: ['permits', orgId, projectId, 'list'],
    queryFn: () => listPermits(api, target!),
    enabled: target !== null,
  });

  if (!orgId) {
    return (
      <Screen title="Permits">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (flags.isPending || permits.isPending) {
    return (
      <Screen title="Permits">
        <StateMessage loading message="Loading permits" />
      </Screen>
    );
  }
  if (flags.isError || permits.isError) {
    return (
      <Screen title="Permits">
        <StateMessage
          tone="danger"
          message="Could not load permits. Check your connection."
          onRetry={() => {
            void flags.refetch();
            void permits.refetch();
          }}
        />
      </Screen>
    );
  }
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  return (
    <Screen title="Permits">
      <Text accessibilityRole="header" style={heading}>
        Needs attention
      </Text>
      {flags.data.length === 0 ? <StateMessage message="Nothing needs attention." /> : null}
      {flags.data.map((f, i) => (
        <ListItem
          key={`${f.kind}-${f.permitId ?? i}`}
          title={f.title}
          subtitle={f.detail}
          onPress={
            f.permitId ? () => router.push(mobileRoutes.permit(projectId, f.permitId!)) : undefined
          }
        />
      ))}
      <Text accessibilityRole="header" style={heading}>
        Register
      </Text>
      {permits.data.length === 0 ? (
        <StateMessage message="No permits on the register yet." />
      ) : null}
      {permits.data.map((p) => (
        <ListItem
          key={p.id}
          title={p.title}
          subtitle={permitSubtitle(p)}
          onPress={() => router.push(mobileRoutes.permit(projectId, p.id))}
        />
      ))}
    </Screen>
  );
}
