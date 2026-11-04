// The minutes of one meeting, read-only on the phone (MTG-US8, MTG-AC7). A subcontractor gets the latest issued version
// without internal-only sections, because that is all the API returns to them.
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { getMeeting } from '../commands';
import { KIND_TEXT, carriedText, dueText } from '../format';

export function MeetingMinutesScreen({
  projectId,
  meetingId,
}: {
  projectId: string;
  meetingId: string;
}) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const meeting = useQuery({
    queryKey: ['meetings', orgId, projectId, 'detail', meetingId],
    queryFn: () => getMeeting(api, { orgId: orgId!, projectId }, meetingId),
    enabled: orgId !== null,
  });

  if (!orgId) {
    return (
      <Screen title="Minutes">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (meeting.isPending) {
    return (
      <Screen title="Minutes">
        <StateMessage loading message="Loading minutes" />
      </Screen>
    );
  }
  if (meeting.isError) {
    return (
      <Screen title="Minutes">
        <StateMessage
          tone="danger"
          message="Could not load these minutes."
          onRetry={() => void meeting.refetch()}
        />
      </Screen>
    );
  }
  const d = meeting.data;
  const m = d.meeting;
  const heading = { color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' as const };
  const issued = d.viewer.viewingVersion ?? m.issuedVersion;
  return (
    <Screen title={m.title}>
      <ListItem
        title={
          m.status === 'issued' || d.viewer.audience === 'external'
            ? `Minutes version ${issued}`
            : 'Draft, not issued'
        }
        subtitle={
          [m.location, m.correctionsBy ? `Corrections by ${m.correctionsBy}` : null]
            .filter(Boolean)
            .join('. ') || null
        }
      />
      <Text accessibilityRole="header" style={heading}>
        Attendance
      </Text>
      {d.attendees.map((a) => (
        <ListItem
          key={a.id}
          title={a.name}
          subtitle={[a.companyName, a.role, a.attendance].filter(Boolean).join(', ')}
        />
      ))}
      {d.sections.map((s) => (
        <View key={s.id} style={{ gap: t.space[2] }}>
          <Text accessibilityRole="header" style={heading}>
            {`${s.position}. ${s.title}`}
          </Text>
          {s.live ? (
            <>
              {s.live.rows.map((r) => (
                <ListItem key={r.ref} title={`${r.ref}  ${r.title}`} subtitle={r.detail} />
              ))}
              {s.live.rows.length === 0 && !s.live.restricted ? (
                <StateMessage message="Nothing on this list." />
              ) : null}
              {s.live.restricted ? <StateMessage message="This list is hidden from you." /> : null}
            </>
          ) : null}
          {s.items.length === 0 && !s.live ? <StateMessage message="Nothing recorded." /> : null}
          {s.items.map((i) => (
            <ListItem
              key={i.id}
              title={`${i.itemNo}  ${i.body}`}
              subtitle={[
                KIND_TEXT[i.kind],
                i.kind === 'action' ? (i.status === 'open' ? 'Open' : 'Closed') : null,
                i.ownerName ? `Owner: ${i.ownerName}` : null,
                i.dueDate ? dueText(i.dueDate, false) : null,
                carriedText(i.carriedCount),
              ]
                .filter(Boolean)
                .join('. ')}
            />
          ))}
        </View>
      ))}
    </Screen>
  );
}
