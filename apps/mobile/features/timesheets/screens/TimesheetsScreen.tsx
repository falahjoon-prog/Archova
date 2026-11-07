// Day sheets for the last two weeks. Filter by status; tap one to review it.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { localDateOf } from '@archova/time';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { deviceTimeZone } from '../../../lib/capture/capture';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { listTimesheets } from '../commands';
import { defaultRange, sheetSubtitle, statusLabel } from '../format';

const FILTERS = ['all', 'draft', 'submitted', 'approved', 'rejected'] as const;

export function TimesheetsScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('submitted');
  // The device zone stands in for the project's: the range is two weeks, so a day's difference changes nothing.
  const range = defaultRange(localDateOf(new Date(), deviceTimeZone() ?? 'UTC'));
  const sheets = useQuery({
    queryKey: ['timesheets', orgId, projectId, 'list', range.from, range.to],
    queryFn: () => listTimesheets(api, { orgId: orgId!, projectId }, range),
    enabled: orgId !== null,
  });
  if (!orgId) {
    return (
      <Screen title="Timesheets">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  const shown = (sheets.data ?? [])
    .filter((s) => filter === 'all' || s.status === filter)
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Screen title="Timesheets">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] }}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
            onPress={() => setFilter(f)}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: t.space[3],
              borderRadius: t.radius.md,
              borderWidth: 1,
              borderColor: filter === f ? t.color.actionPrimary : t.color.borderControl,
            }}
          >
            <Text style={{ color: filter === f ? t.color.actionPrimary : t.color.text }}>
              {f === 'all' ? 'All' : statusLabel(f)}
            </Text>
          </Pressable>
        ))}
      </View>
      {sheets.isPending ? <StateMessage loading message="Loading timesheets" /> : null}
      {sheets.isError ? (
        <StateMessage
          tone="danger"
          message="Could not load timesheets. Check your connection."
          onRetry={() => void sheets.refetch()}
        />
      ) : null}
      {sheets.data && shown.length === 0 ? <StateMessage message="No timesheets here." /> : null}
      {shown.map((s) => (
        <ListItem
          key={s.id}
          title={sheetSubtitle(s)}
          onPress={() => router.push(mobileRoutes.timesheet(projectId, s.id))}
        />
      ))}
    </Screen>
  );
}
