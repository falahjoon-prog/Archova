// Sustainability on the phone: how the project is tracking, what Nova flags, and the conditions to keep up. Reads need a signal; starting a condition is saved on the phone and sent later when offline.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { PendingActions, StateMessage, useAttempt, useCurrentOrg } from '../../../shared';
import { getSummary, listConditions, startCondition } from '../commands';
import { carbonText, conditionSubtitle, percentText, tonnesText } from '../format';

export function EnvironmentScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const attempt = useAttempt();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const target = orgId ? { orgId, projectId } : null;
  const summary = useQuery({
    queryKey: ['environment', orgId, projectId, 'summary'],
    queryFn: () => getSummary(api, target!),
    enabled: target !== null,
  });
  const conditions = useQuery({
    queryKey: ['environment', orgId, projectId, 'conditions'],
    queryFn: () => listConditions(api, target!),
    enabled: target !== null,
  });
  const start = useMutation({
    mutationFn: (c: { id: string; version: number }) =>
      attempt(
        {
          projectId,
          kind: 'environment.startCondition',
          targetId: c.id,
          payload: { version: c.version },
        },
        () => startCondition(api, target!, c),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['environment', orgId, projectId] }),
  });

  if (!orgId) {
    return (
      <Screen title="Environment">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (summary.isPending || conditions.isPending) {
    return (
      <Screen title="Environment">
        <StateMessage loading message="Loading environment" />
      </Screen>
    );
  }
  if (summary.isError || conditions.isError) {
    return (
      <Screen title="Environment">
        <StateMessage
          tone="danger"
          message="Could not load the environment summary. Check your connection."
          onRetry={() => {
            void summary.refetch();
            void conditions.refetch();
          }}
        />
      </Screen>
    );
  }
  const s = summary.data;
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  return (
    <Screen title="Environment">
      <Text accessibilityRole="header" style={heading}>
        Needs attention
      </Text>
      {s.flags.length === 0 ? <StateMessage message="Nothing needs attention." /> : null}
      {s.flags.map((f) => (
        <ListItem
          key={f.code}
          title={
            f.severity === 'critical' ? 'Critical' : f.severity === 'warning' ? 'Warning' : 'Note'
          }
          subtitle={f.message}
        />
      ))}
      <Text accessibilityRole="header" style={heading}>
        Summary
      </Text>
      <ListItem
        title="Conditions signed off"
        subtitle={`${percentText(s.conditions.compliancePercent)}. ${s.conditions.overdue} overdue, ${s.conditions.byStatus.non_compliant} non-compliant`}
      />
      <ListItem
        title="Monitoring"
        subtitle={`${s.monitoring.points} points, ${s.monitoring.openBreaches} open breaches, ${s.monitoring.overdue} without a recent reading`}
      />
      <ListItem
        title="Waste"
        subtitle={`${tonnesText(s.waste.totalTonnes)}, ${percentText(s.waste.diversionPercent)} diverted from landfill`}
      />
      <ListItem
        title="Carbon"
        subtitle={`${carbonText(s.carbon.totalKg)} in total, ${carbonText(s.carbon.last30Kg)} in the last 30 days`}
      />
      <ListItem
        title="Documents"
        subtitle={`${s.documents.total} on file, ${s.documents.expired} expired, ${s.documents.expiring} expiring`}
      />
      <Text accessibilityRole="header" style={heading}>
        Conditions
      </Text>
      {conditions.data.length === 0 ? (
        <StateMessage message="No conditions on the register yet." />
      ) : null}
      {conditions.data.map((c) => (
        <View key={c.id} style={{ gap: t.space[2] }}>
          <ListItem title={c.title} subtitle={conditionSubtitle(c)} />
          <PendingActions targetId={c.id} />
          {c.availableActions.includes('start') ? (
            <Button
              label="Start"
              variant="secondary"
              loading={start.isPending && start.variables?.id === c.id}
              onPress={() => start.mutate({ id: c.id, version: c.version })}
            />
          ) : null}
        </View>
      ))}
      {start.data === 'queued' ? (
        <StateMessage message="No signal. This is saved on this phone and will be sent when you are online." />
      ) : null}
      {start.isError ? (
        <StateMessage tone="danger" message="Could not start that condition. Try again." />
      ) : null}
    </Screen>
  );
}
