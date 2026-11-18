// One permit with its history. The only action here is starting a renewal; the rest stays on the web.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Text } from 'react-native';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { getPermit, startRenewal } from '../commands';
import { EVENT_TEXT, KIND_TEXT, STATUS_TEXT, dayText, expiryText } from '../format';

export function PermitScreen({ projectId, permitId }: { projectId: string; permitId: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const target = orgId ? { orgId, projectId } : null;
  const permit = useQuery({
    queryKey: ['permits', orgId, projectId, 'detail', permitId],
    queryFn: () => getPermit(api, target!, permitId),
    enabled: target !== null,
  });
  const renew = useMutation({
    mutationFn: (p: { id: string; version: number }) => startRenewal(api, target!, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['permits', orgId, projectId] }),
  });

  if (!orgId) {
    return (
      <Screen title="Permit">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (permit.isPending) {
    return (
      <Screen title="Permit">
        <StateMessage loading message="Loading permit" />
      </Screen>
    );
  }
  if (permit.isError) {
    return (
      <Screen title="Permit">
        <StateMessage
          tone="danger"
          message="Could not load this permit."
          onRetry={() => void permit.refetch()}
        />
      </Screen>
    );
  }
  const { permit: p, events } = permit.data;
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  return (
    <Screen title={p.title}>
      <ListItem
        title={`${p.numberLabel}, ${STATUS_TEXT[p.status] ?? p.status}`}
        subtitle={`${KIND_TEXT[p.kind] ?? p.kind}. ${p.lifecycle === 'closed' ? 'Closed' : expiryText(p.daysToExpiry)}`}
      />
      <ListItem title="Issuing authority" subtitle={p.issuingAuthority ?? 'None recorded'} />
      <ListItem title="Reference number" subtitle={p.referenceNumber ?? 'None recorded'} />
      <ListItem title="Issued" subtitle={dayText(p.issuedOn)} />
      <ListItem title="Expires" subtitle={dayText(p.expiresOn)} />
      {p.notes ? <ListItem title="Notes" subtitle={p.notes} /> : null}
      {p.lifecycle === 'active' ? (
        <Button
          label="Start renewal"
          loading={renew.isPending}
          onPress={() => renew.mutate({ id: p.id, version: p.version })}
        />
      ) : null}
      {renew.isError ? (
        <StateMessage
          tone="danger"
          message="Could not start the renewal. You may not have permission, or it changed. Try again."
        />
      ) : null}
      <Text accessibilityRole="header" style={heading}>
        History
      </Text>
      {events.map((e) => (
        <ListItem
          key={e.id}
          title={EVENT_TEXT[e.action] ?? e.action}
          subtitle={`${new Date(e.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}${e.note ? `. ${e.note}` : ''}`}
        />
      ))}
    </Screen>
  );
}
