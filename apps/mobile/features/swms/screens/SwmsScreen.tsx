// One SWMS: what the work is, the hazards and controls, who has acknowledged it, and the actions you can take.
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@archova/api-client';
import { uuidv7 } from '@archova/domain';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { openOrgFile } from '../../../lib/files/open-file';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { useMe } from '../../platform';
import { acknowledgeSwms, getSwms, transitionSwms, type SwmsAction } from '../commands';
import { ACTION_TEXT, LEVEL_TEXT, categoryLabel, needsReason, statusLabel } from '../format';

export function SwmsScreen({ projectId, swmsId }: { projectId: string; swmsId: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const me = useMe().data?.user;
  const [reason, setReason] = useState('');
  const ackKey = useRef(uuidv7());
  const target = { orgId: orgId ?? '', projectId };
  const key = ['swms', orgId, projectId, 'detail', swmsId];
  const detail = useQuery({
    queryKey: key,
    queryFn: () => getSwms(api, target, swmsId),
    enabled: orgId !== null,
  });
  const done = (d: Awaited<ReturnType<typeof getSwms>>) => {
    qc.setQueryData(key, d);
    void qc.invalidateQueries({ queryKey: ['swms', orgId, projectId, 'list'] });
  };
  const acknowledge = useMutation({
    mutationFn: () =>
      acknowledgeSwms(api, target, {
        swmsId,
        workerName: me?.name ?? '',
        idempotencyKey: ackKey.current,
      }),
    onSuccess: (d) => {
      ackKey.current = uuidv7();
      done(d);
    },
  });
  const act = useMutation({
    mutationFn: (action: SwmsAction) =>
      transitionSwms(api, target, detail.data!.swms, { action, reason }),
    onSuccess: (d) => {
      setReason('');
      done(d);
    },
  });

  if (!orgId) {
    return (
      <Screen title="SWMS">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (detail.isPending) {
    return (
      <Screen title="SWMS">
        <StateMessage loading message="Loading SWMS" />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen title="SWMS">
        <StateMessage
          tone="danger"
          message="Could not load this SWMS."
          onRetry={() => void detail.refetch()}
        />
      </Screen>
    );
  }
  const { swms, acknowledgements, availableActions, gaps } = detail.data;
  const mine = me ? acknowledgements.some((a) => a.userId === me.id) : false;
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  const body = { color: t.color.text };
  const failed = (e: unknown) =>
    e instanceof ApiError && e.status < 500 && e.status !== 0 && e.status !== 412
      ? e.message
      : 'Could not save that. Check your connection and try again.';
  return (
    <Screen title={swms.title}>
      <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.md }}>
        {[
          swms.numberLabel,
          statusLabel(swms.status),
          `revision ${swms.revision}`,
          swms.isExpired ? 'expired' : swms.expiresOn ? `expires ${swms.expiresOn}` : null,
        ]
          .filter(Boolean)
          .join(', ')}
      </Text>
      {swms.highRiskWorkCategories.length > 0 ? (
        <Text style={{ color: t.color.textSecondary }}>
          High-risk work: {swms.highRiskWorkCategories.map(categoryLabel).join(', ')}
        </Text>
      ) : null}
      {swms.fileId ? (
        <Button
          label="Open the SWMS document"
          variant="secondary"
          onPress={() => void openOrgFile(api, orgId, swms.fileId!).catch(() => undefined)}
        />
      ) : null}
      {swms.content.workDescription ? (
        <>
          <Text accessibilityRole="header" style={heading}>
            Work
          </Text>
          <Text style={body}>{swms.content.workDescription}</Text>
        </>
      ) : null}
      {swms.content.hazardsAndRisks ? (
        <>
          <Text accessibilityRole="header" style={heading}>
            Hazards and risks
          </Text>
          <Text style={body}>{swms.content.hazardsAndRisks}</Text>
        </>
      ) : null}
      {swms.content.controlMeasures && swms.content.controlMeasures.length > 0 ? (
        <>
          <Text accessibilityRole="header" style={heading}>
            Controls
          </Text>
          {swms.content.controlMeasures.map((c, i) => (
            <ListItem
              key={`${c.level}-${i}`}
              title={c.description}
              subtitle={LEVEL_TEXT[c.level] ?? c.level}
            />
          ))}
        </>
      ) : null}
      {gaps.length > 0 ? (
        <>
          <Text accessibilityRole="header" style={heading}>
            Gaps to fix
          </Text>
          {gaps.map((g) => (
            <Text key={`${g.item}-${g.field}`} style={{ color: t.color.statusDanger }}>
              {g.message}
            </Text>
          ))}
        </>
      ) : null}
      <Text accessibilityRole="header" style={heading}>
        Acknowledged by {acknowledgements.length}
      </Text>
      {acknowledgements.slice(0, 20).map((a) => (
        <ListItem key={`${a.userId}-${a.at}`} title={a.workerName} subtitle={a.at.slice(0, 10)} />
      ))}
      {swms.status === 'accepted' && !swms.isExpired ? (
        mine ? (
          <StateMessage message="You have acknowledged this revision." />
        ) : (
          <Button
            label="I have read and understood this SWMS"
            loading={acknowledge.isPending}
            disabled={!me}
            onPress={() => acknowledge.mutate()}
          />
        )
      ) : null}
      {acknowledge.isError ? (
        <StateMessage tone="danger" message={failed(acknowledge.error)} />
      ) : null}
      {availableActions.length > 0 ? (
        <View style={{ gap: t.space[2] }}>
          <Text accessibilityRole="header" style={heading}>
            Review
          </Text>
          {availableActions.some(needsReason) ? (
            <TextField
              label="Reason (needed to reject or reopen)"
              value={reason}
              onChangeText={setReason}
              multiline
            />
          ) : null}
          {availableActions.map((a) => (
            <Button
              key={a}
              label={ACTION_TEXT[a]}
              variant={a === 'accept' ? 'primary' : 'secondary'}
              disabled={needsReason(a) && reason.trim() === ''}
              loading={act.isPending && act.variables === a}
              onPress={() => act.mutate(a)}
            />
          ))}
          {act.isError ? <StateMessage tone="danger" message={failed(act.error)} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
