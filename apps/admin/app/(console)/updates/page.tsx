'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
} from '@archova/ui';
import {
  PRODUCT_UPDATE_KINDS,
  type ProductUpdateDto,
  type ProductUpdateInput,
} from '@archova/contracts';
import { api } from '@/shared/api';
import { formatDateTime } from '@/shared/format';

const KIND_LABEL: Record<ProductUpdateDto['kind'], string> = {
  feature: 'New feature',
  improvement: 'Improvement',
  fix: 'Fix',
  notice: 'Notice',
};
const STATUS: Record<
  ProductUpdateDto['status'],
  { tone: 'neutral' | 'success' | 'warning'; label: string }
> = {
  draft: { tone: 'warning', label: 'Draft' },
  published: { tone: 'success', label: 'Published' },
  archived: { tone: 'neutral', label: 'Archived' },
};

const EMPTY: ProductUpdateInput = {
  title: '',
  summary: '',
  body: '',
  kind: 'feature',
  showBanner: false,
};

function Editor({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial: ProductUpdateInput;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (v: ProductUpdateInput) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const valid = v.title.trim().length >= 3 && v.summary.trim().length >= 3 && v.body.length <= 5000;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(v);
      }}
    >
      <TextField
        label="Title"
        value={v.title}
        maxLength={120}
        onChange={(e) => setV({ ...v, title: e.target.value })}
      />
      <Select
        label="Type"
        value={v.kind}
        onChange={(e) => setV({ ...v, kind: e.target.value as ProductUpdateInput['kind'] })}
        options={PRODUCT_UPDATE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
      />
      <TextField
        label="Summary"
        hint="One line. Shown in the banner and at the top of the entry."
        value={v.summary}
        maxLength={240}
        onChange={(e) => setV({ ...v, summary: e.target.value })}
      />
      <Textarea
        label="Details (optional)"
        hint="Plain text. A blank line starts a new paragraph."
        rows={6}
        value={v.body}
        maxLength={5000}
        onChange={(e) => setV({ ...v, body: e.target.value })}
      />
      <Checkbox
        label="Also show as a banner in the app"
        hint="Every signed-in user sees the newest banner update until they dismiss it."
        checked={v.showBanner}
        onChange={(e) => setV({ ...v, showBanner: e.target.checked })}
      />
      {error ? (
        <Alert tone="danger" title="Could not save">
          {error}
        </Alert>
      ) : null}
      <div className="row">
        <Button type="submit" disabled={!valid || busy}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="tertiary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function UpdateCard({ u }: { u: ProductUpdateDto }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const done = (r: { items: ProductUpdateDto[] }) => {
    qc.setQueryData(['product-updates'], r);
    setEditing(false);
  };
  const save = useMutation({
    mutationFn: (v: ProductUpdateInput) => api.updateProductUpdate(u.id, v),
    onSuccess: done,
  });
  const publish = useMutation({
    mutationFn: () => api.publishProductUpdate(u.id),
    onSuccess: done,
  });
  const archive = useMutation({
    mutationFn: () => api.archiveProductUpdate(u.id),
    onSuccess: done,
  });
  const st = STATUS[u.status];
  const err = (save.error ?? publish.error ?? archive.error)?.message ?? null;
  return (
    <Card>
      <div className="stack">
        <div className="row">
          <h2 className="flag__title">{u.title}</h2>
          <StatusPill tone={st.tone}>{st.label}</StatusPill>
        </div>
        {editing ? (
          <Editor
            initial={{
              title: u.title,
              summary: u.summary,
              body: u.body,
              kind: u.kind,
              showBanner: u.showBanner,
            }}
            submitLabel="Save changes"
            busy={save.isPending}
            error={save.error?.message ?? null}
            onSubmit={(v) => save.mutate(v)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <p>{u.summary}</p>
            {u.body ? <p className="muted table-cell-wrap">{u.body}</p> : null}
            <p className="muted">
              {KIND_LABEL[u.kind]}
              {u.showBanner ? ' · shows as an in-app banner' : ''} · written by {u.createdBy}
              {u.publishedAt ? ` · published ${formatDateTime(u.publishedAt)}` : ''}
            </p>
            {err ? (
              <Alert tone="danger" title="That did not work">
                {err}
              </Alert>
            ) : null}
            <div className="row">
              {u.status !== 'archived' ? (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              ) : null}
              {u.status === 'draft' ? (
                <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
                  Publish to all customers
                </Button>
              ) : null}
              {u.status === 'published' ? (
                <Button
                  variant="secondary"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate()}
                >
                  Take down
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export default function ProductUpdatesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['product-updates'], queryFn: api.productUpdates });
  const [formKey, setFormKey] = useState(0);
  const create = useMutation({
    mutationFn: (v: ProductUpdateInput) => api.createProductUpdate(v),
    onSuccess: (r) => {
      qc.setQueryData(['product-updates'], r);
      setFormKey((k) => k + 1);
    },
  });
  return (
    <>
      <PageHeader
        title="Product updates"
        description="Release notes and notices for every customer. Published updates appear on the website changelog and, if you tick the banner option, as a dismissible banner in the app."
      />
      <Card>
        <div className="stack">
          <h2 className="flag__title">New update</h2>
          <Editor
            key={formKey}
            initial={EMPTY}
            submitLabel="Save draft"
            busy={create.isPending}
            error={create.error?.message ?? null}
            onSubmit={(v) => create.mutate(v)}
          />
        </div>
      </Card>
      {list.isError ? (
        <Alert tone="danger" title="Could not load updates">
          {list.error.message}
        </Alert>
      ) : list.isPending ? (
        <SkeletonRows />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title="No updates yet"
          description="Drafts and published updates appear here."
        />
      ) : (
        <div className="stack">
          {list.data.items.map((u) => (
            <UpdateCard key={u.id} u={u} />
          ))}
        </div>
      )}
    </>
  );
}
