// One document with its revisions, newest first. Opening a revision shows the file in the system viewer.
import { useState } from 'react';
import { Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Button, ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { openOrgFile } from '../../../lib/files/open-file';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { getDocument } from '../commands';
import { dayText, docStatusLabel } from '../format';

export function DocumentScreen({
  projectId,
  documentId,
}: {
  projectId: string;
  documentId: string;
}) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const [openError, setOpenError] = useState(false);
  const doc = useQuery({
    queryKey: ['documents', orgId, projectId, 'detail', documentId],
    queryFn: () => getDocument(api, { orgId: orgId!, projectId }, documentId),
    enabled: orgId !== null,
  });
  const open = (fileId: string) => {
    setOpenError(false);
    openOrgFile(api, orgId!, fileId).catch(() => setOpenError(true));
  };

  if (!orgId) {
    return (
      <Screen title="Document">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (doc.isPending) {
    return (
      <Screen title="Document">
        <StateMessage loading message="Loading document" />
      </Screen>
    );
  }
  if (doc.isError) {
    return (
      <Screen title="Document">
        <StateMessage
          tone="danger"
          message="Could not load this document."
          onRetry={() => void doc.refetch()}
        />
      </Screen>
    );
  }
  const { document, revisions } = doc.data;
  const current = revisions.find((r) => r.status === 'current') ?? revisions[0];
  return (
    <Screen title={document.title}>
      <Text style={{ color: t.color.textSecondary, fontSize: t.font.size.md }}>
        {[
          document.docNumber,
          docStatusLabel(document.status),
          document.discipline,
          document.docType,
        ]
          .filter(Boolean)
          .join(', ')}
      </Text>
      {current ? (
        <Button
          label={`Open current revision (${current.rev})`}
          onPress={() => open(current.fileId)}
        />
      ) : (
        <StateMessage message="This document has no file yet." />
      )}
      {openError ? (
        <StateMessage tone="danger" message="Could not open that file. Try again." />
      ) : null}
      <Text
        accessibilityRole="header"
        style={{ color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' }}
      >
        Revisions
      </Text>
      {revisions.map((r) => (
        <ListItem
          key={r.id}
          title={`Rev ${r.rev}${r.status === 'superseded' ? ' (superseded)' : ''}`}
          subtitle={
            [r.issuedFor, dayText(r.issuedDate), r.notes].filter(Boolean).join(', ') || undefined
          }
          onPress={() => open(r.fileId)}
        />
      ))}
    </Screen>
  );
}
