// One talk: who is on the attendance list and who has signed. Tap Sign, hand the phone over, draw, save.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@archova/api-client';
import { uuidv7 } from '@archova/domain';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { createUploadApi } from '../../../lib/files/api';
import { backgroundFileTransfer } from '../../../lib/platform/file-transfer';
import { PendingActions, StateMessage, useAttempt, useCurrentOrg } from '../../../shared';
import { useMe } from '../../platform';
import {
  addAttendees,
  getTalk,
  removeAttendee,
  signAttendee,
  transitionTalk,
  uploadSignature,
} from '../commands';
import { attendeeSubtitle, statusLabel } from '../format';
import { hasInk, type UnitPoint } from '../png';
import { saveSignature } from '../signature-file';
import { StrokePad } from './StrokePad';

export function ToolboxTalkScreen({ projectId, talkId }: { projectId: string; talkId: string }) {
  const t = useTheme();
  const attempt = useAttempt();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const me = useMe().data?.user;
  const [name, setName] = useState('');
  const [signing, setSigning] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<UnitPoint[][]>([]);
  const target = { orgId: orgId ?? '', projectId };
  const key = ['toolbox', orgId, projectId, 'detail', talkId];

  const detail = useQuery({
    queryKey: key,
    queryFn: () => getTalk(api, target, talkId),
    enabled: orgId !== null,
  });
  const refresh = (d: Awaited<ReturnType<typeof getTalk>>) => {
    qc.setQueryData(key, d);
    void qc.invalidateQueries({ queryKey: ['toolbox', orgId, projectId, 'list'] });
  };
  const add = useMutation({
    mutationFn: async (p: { personName: string; userId?: string }) => {
      let updated: Awaited<ReturnType<typeof getTalk>> | null = null;
      const outcome = await attempt(
        { projectId, kind: 'toolbox.addAttendee', targetId: talkId, payload: { ...p } },
        async () => {
          updated = await addAttendees(api, target, detail.data!.talk, [p]);
        },
      );
      return { outcome, updated };
    },
    onSuccess: ({ updated }) => {
      setName('');
      if (updated) refresh(updated);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeAttendee(api, target, detail.data!.talk, id),
    onSuccess: refresh,
  });
  const finish = useMutation({
    mutationFn: async (action: 'close' | 'reopen') => {
      let updated: Awaited<ReturnType<typeof getTalk>> | null = null;
      const outcome = await attempt(
        { projectId, kind: 'toolbox.transition', targetId: talkId, payload: { action } },
        async () => {
          updated = await transitionTalk(api, target, detail.data!.talk, action);
        },
      );
      return { outcome, updated };
    },
    onSuccess: ({ updated }) => {
      if (updated) refresh(updated);
    },
  });
  const sign = useMutation({
    mutationFn: async (attendeeId: string) => {
      const image = await saveSignature(attendeeId, strokes);
      const file = await uploadSignature(
        createUploadApi(api, target.orgId),
        backgroundFileTransfer,
        {
          projectId,
          idempotencyKey: uuidv7(),
          image,
        },
      );
      return signAttendee(api, target, detail.data!.talk, attendeeId, file.id);
    },
    onSuccess: (d) => {
      setSigning(null);
      setStrokes([]);
      refresh(d);
    },
  });

  if (!orgId) {
    return (
      <Screen title="Toolbox talk">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (detail.isPending) {
    return (
      <Screen title="Toolbox talk">
        <StateMessage loading message="Loading talk" />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen title="Toolbox talk">
        <StateMessage
          tone="danger"
          message="Could not load this talk."
          onRetry={() => void detail.refetch()}
        />
      </Screen>
    );
  }
  const { talk, attendees, topic, canEdit, closeBlockers } = detail.data;
  const open = talk.status === 'open';
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  const signingRow = attendees.find((a) => a.id === signing);
  const mineAdded = me ? attendees.some((a) => a.userId === me.id) : true;
  const failed = (e: unknown) =>
    e instanceof ApiError && e.status < 500 && e.status !== 0 && e.status !== 412
      ? e.message
      : 'Could not save that. Check your connection and try again.';

  if (signingRow) {
    return (
      <Screen title={`Sign: ${signingRow.personName}`}>
        <Text style={{ color: t.color.textSecondary }}>
          {talk.title}. Sign with your finger inside the box.
        </Text>
        <StrokePad onChange={setStrokes} />
        {sign.isError ? <StateMessage tone="danger" message={failed(sign.error)} /> : null}
        <Button
          label="Save signature"
          loading={sign.isPending}
          disabled={!hasInk(strokes)}
          onPress={() => sign.mutate(signingRow.id)}
        />
        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => {
            setSigning(null);
            setStrokes([]);
            sign.reset();
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title={talk.title}>
      <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.md }}>
        {[
          talk.numberLabel,
          statusLabel(talk.status),
          talk.heldAt.slice(0, 10),
          talk.location,
          `${talk.signedCount} of ${talk.attendeeCount} signed`,
        ]
          .filter(Boolean)
          .join(', ')}
      </Text>
      {topic?.talkingPoints ? (
        <>
          <Text accessibilityRole="header" style={heading}>
            Talking points
          </Text>
          <Text style={{ color: t.color.text }}>{topic.talkingPoints}</Text>
        </>
      ) : null}
      <Text accessibilityRole="header" style={heading}>
        Attendance
      </Text>
      {attendees.length === 0 ? <StateMessage message="Nobody added yet." /> : null}
      {attendees.map((a) => (
        <View key={a.id} style={{ gap: t.space[1] }}>
          <ListItem title={a.personName} subtitle={attendeeSubtitle(a)} />
          {open && canEdit && !a.signedAt ? (
            <View style={{ flexDirection: 'row', gap: t.space[2] }}>
              <Button label="Sign" onPress={() => setSigning(a.id)} />
              <Button
                label="Remove"
                variant="secondary"
                loading={remove.isPending && remove.variables === a.id}
                onPress={() => remove.mutate(a.id)}
              />
            </View>
          ) : null}
        </View>
      ))}
      {open && canEdit ? (
        <View style={{ gap: t.space[2] }}>
          {!mineAdded && me ? (
            <Button
              label="Add me"
              variant="secondary"
              loading={add.isPending}
              onPress={() => add.mutate({ personName: me.name, userId: me.id })}
            />
          ) : null}
          <TextField label="Add a name" value={name} onChangeText={setName} />
          <Button
            label="Add to list"
            variant="secondary"
            disabled={name.trim() === ''}
            loading={add.isPending}
            onPress={() => add.mutate({ personName: name.trim() })}
          />
        </View>
      ) : null}
      <PendingActions targetId={talkId} />
      {add.data?.outcome === 'queued' || finish.data?.outcome === 'queued' ? (
        <StateMessage message="No signal. This is saved on this phone and will be sent when you are online." />
      ) : null}
      {add.isError || remove.isError || finish.isError ? (
        <StateMessage tone="danger" message={failed(add.error ?? remove.error ?? finish.error)} />
      ) : null}
      {canEdit ? (
        open ? (
          <>
            {closeBlockers.map((b) => (
              <Text key={b} style={{ color: t.color.textSecondary }}>
                {b}
              </Text>
            ))}
            <Button
              label="Close talk"
              variant="secondary"
              disabled={closeBlockers.length > 0}
              loading={finish.isPending}
              onPress={() => finish.mutate('close')}
            />
          </>
        ) : (
          <Button
            label="Reopen talk"
            variant="secondary"
            loading={finish.isPending}
            onPress={() => finish.mutate('reopen')}
          />
        )
      ) : null}
    </Screen>
  );
}
