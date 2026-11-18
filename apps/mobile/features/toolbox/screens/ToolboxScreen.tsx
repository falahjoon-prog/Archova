// Toolbox talks for a project, newest first, with a short form to record a new one on site.
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { uuidv7 } from '@archova/domain';
import { mobileRoutes } from '@archova/routes';
import { Button, ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { useMe } from '../../platform';
import { createTalk, listTalks, listTopics } from '../commands';
import { talkSubtitle } from '../format';

export function ToolboxScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useCurrentOrg();
  const me = useMe().data?.user;
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const key = useRef(uuidv7());
  const target = { orgId: orgId ?? '', projectId };

  const talks = useQuery({
    queryKey: ['toolbox', orgId, projectId, 'list'],
    queryFn: () => listTalks(api, target),
    enabled: orgId !== null,
  });
  const topics = useQuery({
    queryKey: ['toolbox', orgId, projectId, 'topics'],
    queryFn: () => listTopics(api, target),
    enabled: orgId !== null && creating,
  });
  const create = useMutation({
    mutationFn: () =>
      createTalk(
        api,
        target,
        {
          title,
          topicId,
          location,
          heldAt: new Date().toISOString(),
          presenterName: me?.name ?? '',
          attendees: me ? [{ personName: me.name, userId: me.id }] : [],
        },
        key.current,
      ),
    onSuccess: (detail) => {
      key.current = uuidv7();
      setCreating(false);
      setTitle('');
      setTopicId(null);
      setLocation('');
      void qc.invalidateQueries({ queryKey: ['toolbox', orgId, projectId] });
      router.push(mobileRoutes.toolboxTalk(projectId, detail.talk.id));
    },
  });

  if (!orgId) {
    return (
      <Screen title="Toolbox talks">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  return (
    <Screen title="Toolbox talks">
      {creating ? (
        <View style={{ gap: t.space[2] }}>
          <Text
            accessibilityRole="header"
            style={{ color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' }}
          >
            New talk
          </Text>
          {topics.data && topics.data.length > 0 ? (
            <View style={{ gap: t.space[2] }}>
              <Text style={{ color: t.color.textSecondary }}>
                Pick a topic or type your own title.
              </Text>
              {topics.data
                .filter((x) => x.isActive)
                .slice(0, 8)
                .map((x) => (
                  <Button
                    key={x.id}
                    label={x.title}
                    variant={topicId === x.id ? 'primary' : 'secondary'}
                    onPress={() => {
                      setTopicId(x.id);
                      setTitle(x.title);
                    }}
                  />
                ))}
            </View>
          ) : null}
          <TextField
            label="Title"
            value={title}
            onChangeText={(v) => {
              setTitle(v);
              setTopicId(null);
            }}
          />
          <TextField label="Where (optional)" value={location} onChangeText={setLocation} />
          <Button
            label="Start talk"
            loading={create.isPending}
            disabled={title.trim() === '' || !me}
            onPress={() => create.mutate()}
          />
          <Button label="Cancel" variant="secondary" onPress={() => setCreating(false)} />
          {create.isError ? (
            <StateMessage
              tone="danger"
              message="Could not record the talk. Check your connection, or you may not run talks on this project."
            />
          ) : null}
        </View>
      ) : (
        <Button label="New talk" onPress={() => setCreating(true)} />
      )}
      {talks.isPending ? <StateMessage loading message="Loading talks" /> : null}
      {talks.isError ? (
        <StateMessage
          tone="danger"
          message="Could not load toolbox talks. Check your connection."
          onRetry={() => void talks.refetch()}
        />
      ) : null}
      {talks.data && talks.data.length === 0 ? (
        <StateMessage message="No toolbox talks yet." />
      ) : null}
      {talks.data?.map((x) => (
        <ListItem
          key={x.id}
          title={x.title}
          subtitle={talkSubtitle(x)}
          onPress={() => router.push(mobileRoutes.toolboxTalk(projectId, x.id))}
        />
      ))}
    </Screen>
  );
}
