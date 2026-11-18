// The sections of one spec book, grouped by division. Tapping a section opens the book at its first page.
import { Fragment, useState } from 'react';
import { Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ListItem, Screen, useTheme } from '@archova/ui-native';
import { api } from '../../../lib/api';
import { openOrgFile } from '../../../lib/files/open-file';
import { StateMessage, useCurrentOrg } from '../../../shared';
import { getSpecBook } from '../commands';
import { byDivision, sectionSubtitle, sectionTitle } from '../format';

export function SpecBookScreen({ projectId, bookId }: { projectId: string; bookId: string }) {
  const t = useTheme();
  const { orgId } = useCurrentOrg();
  const [openError, setOpenError] = useState(false);
  const book = useQuery({
    queryKey: ['specs', orgId, projectId, 'book', bookId],
    queryFn: () => getSpecBook(api, { orgId: orgId!, projectId }, bookId),
    enabled: orgId !== null,
  });

  if (!orgId) {
    return (
      <Screen title="Specification">
        <StateMessage message="Choose an organisation on the Home tab first." />
      </Screen>
    );
  }
  if (book.isPending) {
    return (
      <Screen title="Specification">
        <StateMessage loading message="Loading sections" />
      </Screen>
    );
  }
  if (book.isError) {
    return (
      <Screen title="Specification">
        <StateMessage
          tone="danger"
          message="Could not load this book."
          onRetry={() => void book.refetch()}
        />
      </Screen>
    );
  }
  const fileId = book.data.book.fileId;
  return (
    <Screen title={book.data.book.name}>
      {book.data.sections.length === 0 ? (
        <StateMessage message="This book has no sections yet." />
      ) : null}
      {openError ? (
        <StateMessage tone="danger" message="Could not open the book. Try again." />
      ) : null}
      {byDivision(book.data.sections).map((g) => (
        <Fragment key={g.division}>
          <Text
            accessibilityRole="header"
            style={{ color: t.color.text, fontSize: t.font.size.lg, fontWeight: '600' }}
          >
            {g.division}
          </Text>
          {g.sections.map((s) => (
            <ListItem
              key={s.id}
              title={sectionTitle(s)}
              subtitle={sectionSubtitle(s)}
              {...(fileId
                ? {
                    onPress: () => {
                      setOpenError(false);
                      openOrgFile(api, orgId, fileId, s.pageFrom).catch(() => setOpenError(true));
                    },
                  }
                : {})}
            />
          ))}
        </Fragment>
      ))}
    </Screen>
  );
}
