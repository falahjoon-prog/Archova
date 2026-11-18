// Spec books for the project, with search across every section.
import { useState } from 'react';
import { Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { mobileRoutes } from '@archova/routes';
import { ListItem, Screen, TextField, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { openOrgFile } from '../../../lib/files/open-file';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { listSpecBooks, searchSpecSections } from '../commands';
import { bookSubtitle, sectionSubtitle, sectionTitle } from '../format';

export function SpecificationsScreen({ projectId }: { projectId: string }) {
  const t = useTheme();
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const [q, setQ] = useState('');
  const term = q.trim();
  const books = useQuery({
    queryKey: ['specs', orgId, projectId, 'books'],
    queryFn: () => listSpecBooks(api, { orgId: orgId!, projectId }),
    enabled: orgId !== null,
  });
  const hits = useQuery({
    queryKey: ['specs', orgId, projectId, 'search', term],
    queryFn: () => searchSpecSections(api, { orgId: orgId!, projectId }, term),
    enabled: orgId !== null && term.length > 0,
  });
  const fileOf = new Map((books.data ?? []).map((b) => [b.id, b.fileId]));

  if (!orgId) {
    return (
      <Screen title="Specifications">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (books.isPending) {
    return (
      <Screen title="Specifications">
        <StateMessage loading message="Loading specifications" />
      </Screen>
    );
  }
  if (books.isError) {
    return (
      <Screen title="Specifications">
        <StateMessage
          tone="danger"
          message="Could not load specifications. Check your connection."
          onRetry={() => void books.refetch()}
        />
      </Screen>
    );
  }
  return (
    <Screen title="Specifications">
      <TextField label="Search sections" value={q} onChangeText={setQ} />
      {term ? (
        <>
          {hits.isPending ? <StateMessage loading message="Searching" /> : null}
          {hits.isError ? (
            <StateMessage
              tone="danger"
              message="Search failed. Try again."
              onRetry={() => void hits.refetch()}
            />
          ) : null}
          {hits.data && hits.data.length === 0 ? (
            <StateMessage message="No sections match." />
          ) : null}
          {hits.data?.map((h) => {
            const fileId = fileOf.get(h.bookId);
            return (
              <ListItem
                key={h.section.id}
                title={sectionTitle(h.section)}
                subtitle={`${h.bookName}. ${sectionSubtitle(h.section)}`}
                {...(fileId
                  ? {
                      onPress: () =>
                        void openOrgFile(api, orgId, fileId, h.section.pageFrom).catch(
                          () => undefined,
                        ),
                    }
                  : {})}
              />
            );
          })}
        </>
      ) : (
        <>
          {books.data.length === 0 ? <StateMessage message="No specification books yet." /> : null}
          {books.data.map((b) => (
            <ListItem
              key={b.id}
              title={b.name}
              subtitle={bookSubtitle(b)}
              onPress={() => router.push(mobileRoutes.specBook(projectId, b.id))}
            />
          ))}
        </>
      )}
      <Text style={{ color: t.color.textMuted, fontSize: t.font.size.sm }}>
        Tap a section to open the book at its first page.
      </Text>
    </Screen>
  );
}
