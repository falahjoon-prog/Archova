// One RFI: the question, its responses and, when the ball is with the assignees, a box to answer.
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from '@archova/domain';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { attemptOrQueue } from '../../../lib/actions/attempt';
import { PendingActions, StateMessage, useCurrentOrg, useDeviceData } from '../../../shared';
import { getRfi, respondToRfi } from '../commands';
import { canRespond, statusLabel } from '../format';

export function RfiScreen({ projectId, rfiId }: { projectId: string; rfiId: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const device = useDeviceData();
  const [body, setBody] = useState('');
  // One key per answer being written, so a retry after a dropped reply cannot answer twice.
  const key = useRef(uuidv7());
  const detail = useQuery({
    queryKey: ['rfis', orgId, projectId, 'detail', rfiId],
    queryFn: () => getRfi(api, { orgId: orgId!, projectId }, rfiId),
    enabled: orgId !== null,
  });
  const respond = useMutation({
    mutationFn: (text: string) =>
      attemptOrQueue(
        device.status === 'ready' ? device.data.actions : null,
        {
          id: key.current,
          projectId,
          kind: 'rfi.respond',
          targetId: rfiId,
          payload: { body: text },
        },
        () =>
          respondToRfi(
            api,
            { orgId: orgId!, projectId },
            {
              rfiId,
              body: text,
              idempotencyKey: key.current,
            },
          ),
        () => device.status === 'ready' && device.data.requestSync('connectivity'),
      ),
    onSuccess: () => {
      setBody('');
      key.current = uuidv7();
      void qc.invalidateQueries({ queryKey: ['rfis', orgId, projectId] });
    },
  });

  if (!orgId) {
    return (
      <Screen title="RFI">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (detail.isPending) {
    return (
      <Screen title="RFI">
        <StateMessage loading message="Loading RFI" />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen title="RFI">
        <StateMessage
          tone="danger"
          message="Could not load this RFI."
          onRetry={() => void detail.refetch()}
        />
      </Screen>
    );
  }
  const { rfi, responses } = detail.data;
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  return (
    <Screen title={rfi.subject}>
      <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.md }}>
        {[
          rfi.numberLabel,
          statusLabel(rfi.status),
          rfi.dueDate ? `due ${rfi.dueDate}` : null,
          rfi.isOverdue ? 'overdue' : null,
        ]
          .filter(Boolean)
          .join(', ')}
      </Text>
      {rfi.specSection || rfi.location ? (
        <Text style={{ color: t.color.textSecondary }}>
          {[rfi.specSection, rfi.location].filter(Boolean).join(', ')}
        </Text>
      ) : null}
      <Text accessibilityRole="header" style={heading}>
        Question
      </Text>
      <Text style={{ color: t.color.text }}>{rfi.question || 'No question written yet.'}</Text>
      <Text accessibilityRole="header" style={heading}>
        Responses
      </Text>
      {responses.length === 0 ? <StateMessage message="No responses yet." /> : null}
      {responses.map((r) => (
        <ListItem
          key={r.id}
          title={r.body}
          subtitle={[r.isOfficial ? 'Official answer' : null, r.createdAt.slice(0, 10)]
            .filter(Boolean)
            .join(', ')}
        />
      ))}
      <PendingActions targetId={rfiId} />
      {respond.data === 'queued' ? (
        <StateMessage message="No signal. Your response is saved on this phone and will be sent when you are online." />
      ) : null}
      {canRespond(rfi) ? (
        <View style={{ gap: t.space[2] }}>
          <Text accessibilityRole="header" style={heading}>
            Your response
          </Text>
          <TextField label="Response" value={body} onChangeText={setBody} multiline />
          <Button
            label="Send response"
            loading={respond.isPending}
            disabled={body.trim() === ''}
            onPress={() => respond.mutate(body.trim())}
          />
          {respond.isError ? (
            <StateMessage
              tone="danger"
              message="Could not send that response. You may not be an assignee."
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
