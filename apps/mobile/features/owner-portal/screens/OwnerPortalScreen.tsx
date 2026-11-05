// Owner portal on the phone: published progress, approvals waiting on the client, and the capital plan. Online only.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { capitalPlan, decide, listApprovals, listUpdates } from '../commands';
import { APPROVAL_TEXT, dayText, milestoneText, moneyText, yearLabel } from '../format';

export function OwnerPortalScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const target = orgId ? { orgId, projectId } : null;
  const key = ['owner-portal', orgId, projectId] as const;
  const enabled = target !== null;
  const updates = useQuery({
    queryKey: [...key, 'updates'],
    queryFn: () => listUpdates(api, target!),
    enabled,
  });
  const approvals = useQuery({
    queryKey: [...key, 'approvals'],
    queryFn: () => listApprovals(api, target!),
    enabled,
  });
  const plan = useQuery({
    queryKey: [...key, 'plan'],
    queryFn: () => capitalPlan(api, target!),
    enabled,
  });
  // A decision is final: the first tap asks, the second records it.
  const [confirming, setConfirming] = useState<{
    id: string;
    decision: 'approved' | 'rejected';
  } | null>(null);
  const decision = useMutation({
    mutationFn: (v: { id: string; decision: 'approved' | 'rejected' }) =>
      decide(api, target!, v.id, v.decision),
    onSuccess: () => setConfirming(null),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (!orgId) {
    return (
      <Screen title="Owner portal">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (updates.isPending || approvals.isPending || plan.isPending) {
    return (
      <Screen title="Owner portal">
        <StateMessage loading message="Loading the owner portal" />
      </Screen>
    );
  }
  if (updates.isError || approvals.isError || plan.isError) {
    return (
      <Screen title="Owner portal">
        <StateMessage
          tone="danger"
          message="Could not load the owner portal. Check your connection."
          onRetry={() => {
            void updates.refetch();
            void approvals.refetch();
            void plan.refetch();
          }}
        />
      </Screen>
    );
  }

  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  const body = { color: t.color.text, fontSize: t.font.size.md };
  const waiting = approvals.data.filter((a) => a.status === 'requested');
  const decided = approvals.data.filter((a) => a.status !== 'requested');
  const totals = plan.data.totals;
  return (
    <Screen title="Owner portal">
      <Text accessibilityRole="header" style={heading}>
        Waiting for your decision
      </Text>
      {waiting.length === 0 ? <StateMessage message="Nothing is waiting on you." /> : null}
      {waiting.map((a) => (
        <View key={a.id} style={{ gap: t.space[2] }}>
          <ListItem
            title={`#${a.number}  ${a.title}`}
            subtitle={[
              a.amountCents === null ? null : moneyText(a.amountCents),
              a.dueDate ? `Needed by ${dayText(a.dueDate)}` : null,
              a.description || null,
            ]
              .filter(Boolean)
              .join('. ')}
          />
          {confirming?.id === a.id ? (
            <>
              <Text style={body}>
                {confirming.decision === 'approved' ? 'Approve' : 'Reject'} this request? A decision
                is final.
              </Text>
              <Button
                label={confirming.decision === 'approved' ? 'Confirm approve' : 'Confirm reject'}
                loading={decision.isPending}
                onPress={() => decision.mutate(confirming)}
              />
              <Button label="Cancel" variant="secondary" onPress={() => setConfirming(null)} />
            </>
          ) : (
            <>
              <Button
                label="Approve"
                accessibilityLabel={`Approve ${a.title}`}
                onPress={() => setConfirming({ id: a.id, decision: 'approved' })}
              />
              <Button
                label="Reject"
                variant="secondary"
                accessibilityLabel={`Reject ${a.title}`}
                onPress={() => setConfirming({ id: a.id, decision: 'rejected' })}
              />
            </>
          )}
        </View>
      ))}
      {decision.isError ? (
        <StateMessage
          tone="danger"
          message="Could not record that decision. You may not be allowed to, or it was already decided."
        />
      ) : null}
      {decided.map((a) => (
        <ListItem
          key={a.id}
          title={`#${a.number}  ${a.title}`}
          subtitle={`${APPROVAL_TEXT[a.status]}${a.decisionNote ? `. ${a.decisionNote}` : ''}`}
        />
      ))}

      <Text accessibilityRole="header" style={heading}>
        Progress
      </Text>
      {updates.data.length === 0 ? (
        <StateMessage message="The builder has not published an update yet." />
      ) : null}
      {updates.data.map((u) => (
        <View key={u.id} style={{ gap: t.space[1] }}>
          <ListItem
            title={u.title}
            subtitle={`${dayText(u.periodStart)} to ${dayText(u.periodEnd)}. ${u.percentComplete}% complete`}
          />
          {u.summary ? <Text style={body}>{u.summary}</Text> : null}
          {u.milestones.map((m) => (
            <Text key={m.name} style={body}>
              {milestoneText(m)}
            </Text>
          ))}
        </View>
      ))}

      <Text accessibilityRole="header" style={heading}>
        Capital plan
      </Text>
      {plan.data.items.length === 0 ? <StateMessage message="No capital plan yet." /> : null}
      {totals.map((r) => (
        <ListItem
          key={yearLabel(r.fiscalYear)}
          title={yearLabel(r.fiscalYear)}
          subtitle={`Budget ${moneyText(r.budgetCents)}. Forecast ${moneyText(r.forecastCents)}. Spent ${moneyText(r.spentCents)}`}
        />
      ))}
    </Screen>
  );
}
