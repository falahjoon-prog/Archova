// Project documents: folder chips, search, and the documents in the chosen folder. Online only.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { listDocuments, listFolders } from '../commands';
import { documentSubtitle, folderRows } from '../format';

export function DocumentsScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const [folderId, setFolderId] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const target = orgId ? { orgId, projectId } : null;
  const folders = useQuery({
    queryKey: ['documents', orgId, projectId, 'folders'],
    queryFn: () => listFolders(api, target!),
    enabled: target !== null,
  });
  const docs = useQuery({
    queryKey: ['documents', orgId, projectId, 'list', folderId ?? null, q.trim()],
    queryFn: () => listDocuments(api, target!, { folderId, q }),
    enabled: target !== null,
  });

  if (!orgId) {
    return (
      <Screen title="Documents">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  const chip = (id: string | undefined, label: string, depth = 0) => {
    const on = folderId === id;
    return (
      <Pressable
        key={id ?? 'all'}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        onPress={() => setFolderId(id)}
        style={{
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: t.space[3],
          marginLeft: depth * t.space[2],
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: on ? t.color.actionPrimary : t.color.borderControl,
        }}
      >
        <Text
          style={{ color: on ? t.color.actionPrimary : t.color.text, fontSize: t.font.size.md }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <Screen title="Documents">
      <TextField label="Search documents" value={q} onChangeText={setQ} />
      <View style={{ gap: t.space[2] }}>
        {chip(undefined, 'All folders')}
        {folderRows(folders.data ?? []).map(({ folder, depth }) =>
          chip(folder.id, folder.name, depth),
        )}
      </View>
      {docs.isPending ? <StateMessage loading message="Loading documents" /> : null}
      {docs.isError ? (
        <StateMessage
          tone="danger"
          message="Could not load documents. Check your connection."
          onRetry={() => void docs.refetch()}
        />
      ) : null}
      {docs.data && docs.data.length === 0 ? (
        <StateMessage message="No documents to show here." />
      ) : null}
      {docs.data?.map((d) => (
        <ListItem
          key={d.id}
          title={d.title}
          subtitle={documentSubtitle(d)}
          onPress={() => router.push(mobileRoutes.document(projectId, d.id))}
        />
      ))}
    </Screen>
  );
}
