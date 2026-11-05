// Meetings on the phone: my open actions first (MTG-US9), then the meetings I can read. Online only.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { closeAction, listMeetings, myActions } from '../commands';
import { dueText, meetingSubtitle } from '../format';

export function MeetingsScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const target = orgId ? { orgId, projectId } : null;
  const actions = useQuery({
    queryKey: ['meetings', orgId, projectId, 'actions'],
    queryFn: () => myActions(api, target!),
    enabled: target !== null,
  });
  const meetings = useQuery({
    queryKey: ['meetings', orgId, projectId, 'list'],
    queryFn: () => listMeetings(api, target!),
    enabled: target !== null,
  });
  const close = useMutation({
    mutationFn: (a: { id: string; version: number }) => closeAction(api, target!, a),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings', orgId, projectId] }),
  });

  if (!orgId) {
    return (
      <Screen title="Meetings">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (actions.isPending || meetings.isPending) {
    return (
      <Screen title="Meetings">
        <StateMessage loading message="Loading meetings" />
      </Screen>
    );
  }
  if (actions.isError || meetings.isError) {
    return (
      <Screen title="Meetings">
        <StateMessage
          tone="danger"
          message="Could not load meetings. Check your connection."
          onRetry={() => {
            void actions.refetch();
            void meetings.refetch();
          }}
        />
      </Screen>
    );
  }
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  return (
    <Screen title="Meetings">
      <Text accessibilityRole="header" style={heading}>
        My actions
      </Text>
      {actions.data.length === 0 ? <StateMessage message="You have no open actions." /> : null}
      {actions.data.map((a) => (
        <View key={a.id} style={{ gap: t.space[2] }}>
          <ListItem
            title={`${a.itemNo}  ${a.body}`}
            subtitle={`${dueText(a.dueDate, a.isOverdue)}. ${a.meetingTitle}`}
            onPress={() => router.push(mobileRoutes.meeting(projectId, a.meetingId))}
          />
          <Button
            label="Mark done"
            variant="secondary"
            loading={close.isPending && close.variables?.id === a.id}
            onPress={() => close.mutate({ id: a.id, version: a.version })}
          />
        </View>
      ))}
      {close.isError ? (
        <StateMessage tone="danger" message="Could not close that action. Try again." />
      ) : null}
      <Text accessibilityRole="header" style={heading}>
        Meetings
      </Text>
      {meetings.data.length === 0 ? <StateMessage message="No meetings to show yet." /> : null}
      {meetings.data.map((m) => (
        <ListItem
          key={m.id}
          title={m.title}
          subtitle={meetingSubtitle(m)}
          onPress={() => router.push(mobileRoutes.meeting(projectId, m.id))}
        />
      ))}
    </Screen>
  );
}
