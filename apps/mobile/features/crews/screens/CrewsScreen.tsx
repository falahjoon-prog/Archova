// The next two weeks of shifts. Offers on a shift can be accepted or declined by the person they were made to.
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { addDays, endOfLocalDay, localDateOf, startOfLocalDay } from '@archova/time';
import { ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { deviceTimeZone } from '../../../lib/capture/capture';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { listShifts } from '../commands';
import { assignmentSummary, shiftSubtitle, shiftTitle } from '../format';

export function CrewsScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const zone = deviceTimeZone() ?? 'UTC';
  const today = localDateOf(new Date(), zone);
  const range = {
    from: startOfLocalDay(today, zone).toISOString(),
    to: endOfLocalDay(addDays(today, 13), zone).toISOString(),
  };
  const target = orgId ? { orgId, projectId } : null;
  const shifts = useQuery({
    queryKey: ['crews', orgId, projectId, 'shifts', today],
    queryFn: () => listShifts(api, target!, range),
    enabled: target !== null,
  });
  if (!orgId) {
    return (
      <Screen title="Crews">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (shifts.isPending) {
    return (
      <Screen title="Crews">
        <StateMessage loading message="Loading roster" />
      </Screen>
    );
  }
  if (shifts.isError) {
    return (
      <Screen title="Crews">
        <StateMessage
          tone="danger"
          message="Could not load the roster."
          onRetry={() => void shifts.refetch()}
        />
      </Screen>
    );
  }
  const rows = [...shifts.data].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (
    <Screen title="Crews">
      {rows.length === 0 ? <StateMessage message="No shifts in the next two weeks." /> : null}
      {rows.map((s) => (
        <View key={s.id} style={{ gap: t.space[1] }}>
          <ListItem title={shiftTitle(s)} subtitle={shiftSubtitle(s, zone)} />
          {assignmentSummary(s.assignments) ? (
            <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.sm }}>
              {assignmentSummary(s.assignments)}
            </Text>
          ) : null}
          {s.note ? <Text style={{ color: t.color.textSecondary }}>{s.note}</Text> : null}
        </View>
      ))}
    </Screen>
  );
}
