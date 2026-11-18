'use client';

import { useState } from 'react';
import type { components } from '@archova/contracts/openapi';
import {
  Alert,
  Button,
  Card,
  Dialog,
  RichText,
  RichTextEditor,
  Switch,
  TextField,
} from '@archova/ui';
import type { RichDoc } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useUpdateProject } from '../hooks/useProjectMutations';

const DEFAULT_TITLE = 'Project description';
const EMPTY: RichDoc = { blocks: [] };
const MAX_CHARS = 8000;

const charCount = (doc: RichDoc) =>
  doc.blocks.reduce(
    (n, b) => n + b.lines.reduce((m, l) => m + l.reduce((k, r) => k + r.text.length, 0), 0),
    0,
  );

export type StatusTile = components['schemas']['ProjectStatusTile'];

/**
 * Project home: a free-written status tile. People write what suits the job (scope, works, goal, progress) in a
 * small word-processor box, and can rename the tile. Stored as structured text, so it is shown without any markup.
 */
export function ProjectStatusCard({
  orgId,
  projectId,
  version,
  tile,
  canEdit,
}: {
  orgId: string;
  projectId: string;
  version: number;
  tile: StatusTile | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState(Boolean(tile?.title));
  const [title, setTitle] = useState(tile?.title ?? '');
  const [doc, setDoc] = useState<RichDoc>((tile?.doc as RichDoc | undefined) ?? EMPTY);
  const update = useUpdateProject(orgId, projectId);

  const open = () => {
    setCustom(Boolean(tile?.title));
    setTitle(tile?.title ?? '');
    setDoc((tile?.doc as RichDoc | undefined) ?? EMPTY);
    update.reset();
    setEditing(true);
  };
  const tooLong = charCount(doc) > MAX_CHARS;
  const save = () =>
    update.mutate(
      {
        version,
        body: {
          statusTile:
            doc.blocks.length === 0 && !custom
              ? null
              : { title: custom && title.trim() ? title.trim() : null, doc },
        },
      },
      { onSuccess: () => setEditing(false) },
    );

  const heading = tile?.title || DEFAULT_TITLE;
  return (
    <Card
      title={heading}
      actions={
        canEdit ? (
          <Button variant="secondary" onClick={open}>
            Edit
          </Button>
        ) : undefined
      }
    >
      {tile && tile.doc.blocks.length > 0 ? (
        <RichText doc={tile.doc as RichDoc} />
      ) : (
        <p className="u-muted">
          {canEdit
            ? 'Nothing here yet. Use Edit to write the scope, works, goal and progress for this project.'
            : 'Nothing has been written here yet.'}
        </p>
      )}
      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit project description"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={update.isPending || tooLong}>
              Save
            </Button>
          </>
        }
      >
        <div className="stack">
          <Switch label="Custom title?" checked={custom} onCheckedChange={setCustom} />
          {custom ? (
            <TextField
              label="Title"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              hint={`Shown as "${DEFAULT_TITLE}" when left blank.`}
            />
          ) : null}
          {editing ? (
            <RichTextEditor
              label="Project description"
              initial={(tile?.doc as RichDoc | undefined) ?? EMPTY}
              onChange={setDoc}
            />
          ) : null}
          {tooLong ? (
            <Alert tone="danger" title="Too long">
              Keep it to {MAX_CHARS.toLocaleString()} characters or fewer.
            </Alert>
          ) : null}
          <ErrorAlert error={update.error} title="We couldn't save the description" />
        </div>
      </Dialog>
    </Card>
  );
}
