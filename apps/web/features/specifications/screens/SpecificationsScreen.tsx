'use client';

import { useState } from 'react';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  type DataTableColumn,
} from '@archova/ui';
import { DocumentsIcon } from '@archova/ui/icons';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import type { SpecBook, SpecSection } from '../data/api';
import { useSpecBook, useSpecBooks, useSpecMutations } from '../hooks/useSpecifications';
import { pagesText, parseSections, sectionsToText } from '../lib/sections';

/** Specification books, split into sections by page range so spec references can be found (DOC-US10). */
export function SpecificationsScreen() {
  const [params, setParams] = useUrlState(['book'] as const);
  const books = useSpecBooks();
  const bookId = params.book || null;
  const detail = useSpecBook(bookId);
  const m = useSpecMutations();
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState('');
  const [replaces, setReplaces] = useState('');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const current = (books.data ?? []).filter((b) => b.status === 'current');
  const parsed = parseSections(text);

  const bookColumns: DataTableColumn<SpecBook>[] = [
    {
      id: 'name',
      header: 'Book',
      rowHeader: true,
      cell: (b) => (
        <Button variant="tertiary" onClick={() => setParams({ book: b.id })}>
          {b.name}
        </Button>
      ),
    },
    { id: 'issued', header: 'Issued', cell: (b) => b.issuedDate ?? '—' },
    {
      id: 'status',
      header: 'Status',
      cell: (b) => (
        <StatusPill tone={b.status === 'current' ? 'success' : 'neutral'}>
          {b.status === 'current' ? 'Current' : 'Superseded'}
        </StatusPill>
      ),
    },
    { id: 'sections', header: 'Sections', cell: (b) => b.sectionCount },
  ];
  const sectionColumns: DataTableColumn<SpecSection>[] = [
    { id: 'number', header: 'Section', rowHeader: true, cell: (s) => s.sectionNumber },
    { id: 'title', header: 'Title', cell: (s) => s.title },
    { id: 'pages', header: 'Pages', cell: pagesText },
    { id: 'rev', header: 'Revision', cell: (s) => s.revision ?? '—' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title="Specifications"
        description="Register each issued spec book and split it into sections by page, so RFIs and submittals can point at a section."
        actions={
          <Button
            onClick={() => {
              m.create.reset();
              setName('');
              setIssued('');
              setReplaces('');
              setRegistering(true);
            }}
          >
            Register a book
          </Button>
        }
      />
      <ErrorAlert error={books.error} title="We couldn't load the specification books" />
      {books.isPending ? (
        <SkeletonRows label="Loading specification books…" />
      ) : (books.data ?? []).length === 0 ? (
        <EmptyState
          icon={DocumentsIcon}
          title="No specification books yet"
          description="Register a book, then list its sections with their page numbers."
        />
      ) : (
        <DataTable
          caption="Specification books"
          columns={bookColumns}
          rows={books.data ?? []}
          getRowId={(b) => b.id}
        />
      )}

      {bookId ? (
        <section aria-labelledby="spec-sections-title" className="stack">
          <h2 id="spec-sections-title" className="u-m-0">
            {detail.data ? detail.data.book.name : 'Sections'}
          </h2>
          <ErrorAlert error={detail.error} title="We couldn't load this book" />
          {detail.isPending ? (
            <SkeletonRows label="Loading sections…" />
          ) : detail.data ? (
            <>
              <div className="u-row">
                <Button
                  variant="secondary"
                  onClick={() => {
                    m.saveSections.reset();
                    setText(sectionsToText(detail.data.sections));
                    setEditing(true);
                  }}
                >
                  Edit sections
                </Button>
              </div>
              {detail.data.sections.length === 0 ? (
                <EmptyState
                  icon={DocumentsIcon}
                  title="No sections yet"
                  description="Use Edit sections to list them, one per line."
                />
              ) : (
                <DataTable
                  caption="Sections"
                  columns={sectionColumns}
                  rows={detail.data.sections}
                  getRowId={(s) => s.id}
                />
              )}
            </>
          ) : null}
        </section>
      ) : null}

      <Dialog
        open={registering}
        onClose={() => setRegistering(false)}
        title="Register a specification book"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRegistering(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || m.create.isPending}
              onClick={() =>
                m.create.mutate(
                  {
                    name: name.trim(),
                    ...(issued ? { issuedDate: issued } : {}),
                    ...(replaces ? { supersedesBookId: replaces } : {}),
                  },
                  {
                    onSuccess: (x) => {
                      setRegistering(false);
                      setParams({ book: x.book.id });
                    },
                  },
                )
              }
            >
              {m.create.isPending ? 'Registering…' : 'Register book'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Issue date"
            type="date"
            value={issued}
            onChange={(e) => setIssued(e.target.value)}
          />
          {current.length > 0 ? (
            <Select
              label="Replaces"
              value={replaces}
              options={[
                { value: '', label: 'Nothing, this is a new book' },
                ...current.map((b) => ({ value: b.id, label: b.name })),
              ]}
              onChange={(e) => setReplaces(e.target.value)}
            />
          ) : null}
          <ErrorAlert error={m.create.error} title="We couldn't register the book" />
        </div>
      </Dialog>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit sections"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              disabled={m.saveSections.isPending || parsed.problems.length > 0 || !detail.data}
              onClick={() =>
                detail.data &&
                m.saveSections.mutate(
                  {
                    bookId: detail.data.book.id,
                    version: detail.data.book.version,
                    sections: parsed.sections,
                  },
                  { onSuccess: () => setEditing(false) },
                )
              }
            >
              {m.saveSections.isPending ? 'Saving…' : 'Save sections'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Textarea
            label="Sections, one per line: number, title, pages"
            hint="For example: 03 30 00, Cast-in-place concrete, 4-20"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {parsed.problems.length > 0 ? (
            <ul aria-label="Lines to fix" className="u-m-0">
              {parsed.problems.map((p) => (
                <li key={p.line}>
                  Line {p.line}: {p.why}
                </li>
              ))}
            </ul>
          ) : null}
          <ErrorAlert error={m.saveSections.error} title="We couldn't save the sections" />
        </div>
      </Dialog>
    </>
  );
}
