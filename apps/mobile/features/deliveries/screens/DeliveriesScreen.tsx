// Deliveries booked for the next week. Site staff log the truck arriving and the load unloaded.
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, endOfLocalDay, localDateOf, startOfLocalDay } from '@archova/time';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { deviceTimeZone } from '../../../lib/capture/capture';
import { PendingActions, StateMessage, useAttempt, useCurrentOrg } from '../../../shared';
import { checkInDelivery, listDeliveries } from '../commands';
import { checkInLabel, deliverySubtitle, itemsSummary, nextCheckIn } from '../format';

export function DeliveriesScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const attempt = useAttempt();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const zone = deviceTimeZone() ?? 'UTC';
  const today = localDateOf(new Date(), zone);
  const range = {
    from: startOfLocalDay(today, zone).toISOString(),
    to: endOfLocalDay(addDays(today, 6), zone).toISOString(),
  };
  const target = orgId ? { orgId, projectId } : null;
  const key = ['deliveries', orgId, projectId, today];
  const list = useQuery({
    queryKey: key,
    queryFn: () => listDeliveries(api, target!, range),
    enabled: target !== null,
  });
  const checkIn = useMutation({
    mutationFn: (v: { id: string; event: 'arrived' | 'unloaded' }) => {
      // Stamped now, so a check-in sent later still records when the truck actually arrived.
      const at = new Date().toISOString();
      return attempt(
        {
          projectId,
          kind: 'delivery.checkIn',
          targetId: v.id,
          payload: { event: v.event, at },
        },
        () => checkInDelivery(api, target!, v.id, v.event, at),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  if (!orgId) {
    return (
      <Screen title="Deliveries">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (list.isPending) {
    return (
      <Screen title="Deliveries">
        <StateMessage loading message="Loading deliveries" />
      </Screen>
    );
  }
  if (list.isError) {
    return (
      <Screen title="Deliveries">
        <StateMessage
          tone="danger"
          message="Could not load deliveries."
          onRetry={() => void list.refetch()}
        />
      </Screen>
    );
  }
  const rows = [...list.data].sort((a, b) => a.windowStart.localeCompare(b.windowStart));
  return (
    <Screen title="Deliveries">
      {rows.length === 0 ? <StateMessage message="No deliveries in the next week." /> : null}
      {checkIn.data === 'queued' ? (
        <StateMessage message="No signal. This is saved on this phone and will be sent when you are online." />
      ) : null}
      {checkIn.isError ? (
        <StateMessage tone="danger" message="Could not log that. Try again." />
      ) : null}
      {rows.map((d) => {
        const next = nextCheckIn(d.status);
        return (
          <View key={d.id} style={{ gap: t.space[1] }}>
            <ListItem title={`#${d.number} ${d.title}`} subtitle={deliverySubtitle(d, zone)} />
            {d.items.length > 0 ? (
              <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.sm }}>
                {itemsSummary(d.items)}
              </Text>
            ) : null}
            {d.accessNotes ? (
              <Text style={{ color: t.color.textSecondary }}>{d.accessNotes}</Text>
            ) : null}
            <PendingActions targetId={d.id} />
            {next ? (
              <Button
                label={checkInLabel(next)}
                variant="secondary"
                loading={checkIn.isPending && checkIn.variables?.id === d.id}
                onPress={() => checkIn.mutate({ id: d.id, event: next })}
              />
            ) : null}
          </View>
        );
      })}
    </Screen>
  );
}
