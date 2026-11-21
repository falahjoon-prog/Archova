// Pre-task plans for the day: what is on the project today, what is saved on this phone waiting to send, and the way
// in to start a new plan. Starting and signing a plan works with no signal; this list needs one for today's plans.
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { localDateOf } from '@archova/time';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { deviceTimeZone } from '../../../lib/capture/capture';
import type { PretaskSubmitPayload } from '../../../lib/actions/pretask-send';
import { StateMessage, useCurrentOrg, useDeviceData, useLocalQuery } from '../../../shared';
import { getPlanDetail, listPlansFor, listRecentPlans } from '../commands';
import { planSubtitle } from '../format';

export function PretaskScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const device = useDeviceData();
  const data = device.status === 'ready' ? device.data : null;
  const today = localDateOf(new Date(), deviceTimeZone() ?? 'UTC');
  const target = { orgId: orgId ?? '', projectId };

  const plans = useQuery({
    queryKey: ['pretask', orgId, projectId, 'day', today],
    queryFn: () => listPlansFor(api, target, today),
    enabled: orgId !== null,
  });

  // Keep the newest plan on the phone, so tomorrow's can start from it with no signal.
  const newest = useQuery({
    queryKey: ['pretask', orgId, projectId, 'newest'],
    queryFn: async () => {
      const [first] = await listRecentPlans(api, target);
      return first ? getPlanDetail(api, target, first.id) : null;
    },
    enabled: orgId !== null && data !== null,
  });
  useEffect(() => {
    const d = newest.data;
    if (!d || !data) return;
    void data.pretask.put(projectId, {
      workDate: d.plan.workDate,
      taskTitle: d.plan.taskTitle,
      supervisorName: d.plan.supervisorName,
      ...(d.plan.location ? { location: d.plan.location } : {}),
      ...(d.plan.companyId ? { companyId: d.plan.companyId } : {}),
      ...(d.plan.swmsId ? { swmsId: d.plan.swmsId } : {}),
      hazards: d.plan.hazards,
      crew: d.crew.map((c) => ({
        personName: c.personName,
        ...(c.companyId ? { companyId: c.companyId } : {}),
      })),
    });
  }, [newest.data, data, projectId]);

  const queued = useLocalQuery(data ? () => data.actions.list(projectId) : null, [data, projectId]);
  const waiting = (queued.value ?? []).filter((a) => a.kind === 'pretask.submit');

  if (!orgId) {
    return (
      <Screen title="Pre-task plans">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  return (
    <Screen title="Pre-task plans">
      <Button
        label="Start a plan"
        onPress={() => router.push(mobileRoutes.pretaskNew(projectId))}
      />
      <Text style={{ color: t.color.textSecondary }}>
        You can fill in and sign a plan with no signal. It is saved on this phone and sent when you
        are back online.
      </Text>
      {waiting.map((a) => {
        const p = a.payload as unknown as PretaskSubmitPayload;
        return (
          <View
            key={a.id}
            accessibilityLiveRegion="polite"
            style={{
              gap: t.space[1],
              padding: t.space[3],
              borderRadius: t.radius.md,
              borderWidth: 1,
              borderColor: a.state === 'refused' ? t.color.statusDanger : t.color.statusWarning,
            }}
          >
            <Text style={{ color: t.color.text, fontWeight: '600' }}>{p.taskTitle}</Text>
            <Text style={{ color: t.color.textSecondary }}>
              {a.state === 'pending'
                ? 'Saved on this phone, will send when online.'
                : `The server did not accept it. ${a.lastError ?? ''}`}
            </Text>
            {a.state === 'refused' ? (
              <Button
                label="Dismiss"
                variant="secondary"
                onPress={() => void data?.actions.discard(a.id).then(queued.refresh)}
              />
            ) : (
              <Button
                label="Cancel this"
                variant="secondary"
                onPress={() => void data?.actions.discard(a.id).then(queued.refresh)}
              />
            )}
          </View>
        );
      })}
      {plans.isPending ? <StateMessage loading message="Loading today's plans" /> : null}
      {plans.isError ? (
        <StateMessage
          tone="danger"
          message="Could not load today's plans. You may be offline."
          onRetry={() => void plans.refetch()}
        />
      ) : null}
      {plans.data && plans.data.length === 0 && waiting.length === 0 ? (
        <StateMessage message="No plans for today yet." />
      ) : null}
      {plans.data?.map((p) => (
        <ListItem key={p.id} title={p.taskTitle} subtitle={planSubtitle(p)} />
      ))}
    </Screen>
  );
}
