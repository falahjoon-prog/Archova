// One submittal: details, the latest revision's review steps, and response buttons for the step that is waiting.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { openOrgFile } from '../../../lib/files/open-file';
import { attemptOrQueue } from '../../../lib/actions/attempt';
import { PendingActions, StateMessage, useCurrentOrg, useDeviceData } from '../../../shared';
import { getSubmittal, respondToStep, type ReviewAnswer } from '../commands';
import { ANSWER_TEXT, statusLabel, typeLabel, waitingStep } from '../format';

const ANSWERS: ReviewAnswer[] = ['approved', 'approved_as_noted', 'revise_resubmit', 'rejected'];

export function SubmittalScreen({
  projectId,
  submittalId,
}: {
  projectId: string;
  submittalId: string;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const [comments, setComments] = useState('');
  const device = useDeviceData();
  const key = ['submittals', orgId, projectId, 'detail', submittalId];
  const detail = useQuery({
    queryKey: key,
    queryFn: () => getSubmittal(api, { orgId: orgId!, projectId }, submittalId),
    enabled: orgId !== null,
  });
  const respond = useMutation({
    mutationFn: (a: { stepId: string; response: ReviewAnswer }) =>
      attemptOrQueue(
        device.status === 'ready' ? device.data.actions : null,
        {
          projectId,
          kind: 'submittal.respond',
          targetId: submittalId,
          payload: { ...a, comments: comments.trim() },
        },
        () => respondToStep(api, { orgId: orgId!, projectId }, { submittalId, ...a, comments }),
        () => device.status === 'ready' && device.data.requestSync('connectivity'),
      ),
    onSuccess: () => {
      setComments('');
      void qc.invalidateQueries({ queryKey: ['submittals', orgId, projectId] });
    },
  });

  if (!orgId) {
    return (
      <Screen title="Submittal">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (detail.isPending) {
    return (
      <Screen title="Submittal">
        <StateMessage loading message="Loading submittal" />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen title="Submittal">
        <StateMessage
          tone="danger"
          message="Could not load this submittal."
          onRetry={() => void detail.refetch()}
        />
      </Screen>
    );
  }
  const { submittal, revisions } = detail.data;
  const latest = [...revisions].sort((a, b) => b.revision - a.revision)[0];
  const waiting = waitingStep(revisions, submittal.ballInCourt);
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  return (
    <Screen title={submittal.title}>
      <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.md }}>
        {[
          submittal.numberLabel,
          typeLabel(submittal.type),
          statusLabel(submittal.status),
          submittal.specSection,
        ]
          .filter(Boolean)
          .join(', ')}
      </Text>
      {submittal.requiredOnSite ? (
        <Text style={{ color: t.color.text }}>Required on site {submittal.requiredOnSite}</Text>
      ) : null}
      {latest ? (
        <>
          <Text accessibilityRole="header" style={heading}>
            Revision {latest.revision}
          </Text>
          {latest.note ? <Text style={{ color: t.color.text }}>{latest.note}</Text> : null}
          {latest.fileIds.map((fileId, i) => (
            <Button
              key={fileId}
              label={`Open file ${i + 1}`}
              variant="secondary"
              onPress={() => void openOrgFile(api, orgId, fileId).catch(() => undefined)}
            />
          ))}
          <Text accessibilityRole="header" style={heading}>
            Review steps
          </Text>
          {latest.steps.map((s) => (
            <ListItem
              key={s.id}
              title={`Step ${s.step}, ${s.kind}`}
              subtitle={[statusLabel(s.response), s.comments].filter(Boolean).join(': ')}
            />
          ))}
        </>
      ) : null}
      <PendingActions targetId={submittalId} />
      {respond.data === 'queued' ? (
        <StateMessage message="No signal. Your response is saved on this phone and will be sent when you are online." />
      ) : null}
      {waiting ? (
        <View style={{ gap: t.space[2] }}>
          <Text accessibilityRole="header" style={heading}>
            Your response
          </Text>
          <TextField label="Comments" value={comments} onChangeText={setComments} multiline />
          {ANSWERS.map((a) => (
            <Button
              key={a}
              label={ANSWER_TEXT[a]}
              variant={a === 'approved' ? 'primary' : 'secondary'}
              loading={respond.isPending && respond.variables?.response === a}
              onPress={() => respond.mutate({ stepId: waiting.id, response: a })}
            />
          ))}
          {respond.isError ? (
            <StateMessage
              tone="danger"
              message="Could not send that response. You may not be the reviewer."
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
