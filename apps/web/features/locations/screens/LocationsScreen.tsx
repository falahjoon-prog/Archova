'use client';

import { useState } from 'react';
import { can, type EffectivePermissions } from '@archova/domain/permissions';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { LocationTreeKind, LocationTreeNode } from '../data/api';
import { useCreateLocation, useLocations, useUpdateLocation } from '../hooks/useLocations';
import { KIND_LABELS, MAX_DEPTH, descendantIds, flatten } from '../lib/tree';

const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));

interface Draft {
  id: string | null;
  version: number;
  parentId: string | null;
  kind: LocationTreeKind;
  name: string;
  code: string;
}

const blank = (parentId: string | null): Draft => ({
  id: null,
  version: 0,
  parentId,
  kind: 'area',
  name: '',
  code: '',
});

/** The project's places: building, level, zone, room. Everything raised on site points at one of these. */
export function LocationsScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'locations', id: 'tree' },
  });
  const permissions = useProjectPermissions(org.orgId, project.projectId);
  const canEdit = permissions.data
    ? can(permissions.data as EffectivePermissions, 'platform.projects.update')
    : false;
  const [showArchived, setShowArchived] = useState(false);
  const all = useLocations(project.projectId, true);
  const rows = (all.data ?? []).filter((l) => showArchived || !l.archived);
  const live = (all.data ?? []).filter((l) => !l.archived);
  const create = useCreateLocation(project.projectId);
  const update = useUpdateLocation(project.projectId);
  const [draft, setDraft] = useState<Draft | null>(null);

  const edit = (l: LocationTreeNode) =>
    setDraft({
      id: l.id,
      version: l.version,
      parentId: l.parentId,
      kind: l.kind,
      name: l.name,
      code: l.code ?? '',
    });

  const save = () => {
    if (!draft) return;
    const code = draft.code.trim() || null;
    const done = { onSuccess: () => setDraft(null) };
    if (draft.id)
      update.mutate(
        {
          id: draft.id,
          version: draft.version,
          body: { name: draft.name, kind: draft.kind, code, parentId: draft.parentId },
        },
        done,
      );
    else
      create.mutate(
        { name: draft.name, kind: draft.kind, ...(code ? { code } : {}), parentId: draft.parentId },
        done,
      );
  };

  const saving = create.isPending || update.isPending;
  const saveError = create.error ?? update.error;
  const excluded = draft?.id ? descendantIds(live, draft.id) : new Set<string>();
  const parentOptions = flatten(live)
    .filter(({ location, depth }) => !excluded.has(location.id) && depth + 1 < MAX_DEPTH)
    .map(({ location }) => ({ value: location.id, label: location.path }));

  return (
    <div className="stack-lg">
      <PageHeader
        title="Location tree"
        description="Buildings, levels, zones and rooms. Defects, RFIs, inspections and observations point at one of these, so every register can be filtered and reported by place."
        actions={
          canEdit ? <Button onClick={() => setDraft(blank(null))}>Add location</Button> : undefined
        }
      />
      <ErrorAlert error={all.error} title="We couldn't load the locations" />
      {all.isPending ? <SkeletonRows rows={5} label="Loading locations…" /> : null}
      {all.data && live.length === 0 ? (
        <EmptyState
          title="No locations yet"
          description={
            canEdit
              ? 'Start with a building or the site, then add levels and rooms inside it.'
              : 'A project administrator adds the building, levels and rooms.'
          }
          action={
            canEdit ? (
              <Button onClick={() => setDraft(blank(null))}>Add the first location</Button>
            ) : undefined
          }
        />
      ) : null}
      {all.data && rows.length > 0 ? (
        <Card
          title="Location tree"
          actions={
            <Checkbox
              label="Show archived"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
          }
        >
          <ul className="location-tree" aria-label="Project location tree">
            {flatten(rows).map(({ location: l, depth }) => (
              <li
                key={l.id}
                className={l.archived ? 'location-tree__row u-muted' : 'location-tree__row'}
                style={{ paddingInlineStart: `calc(var(--space-4) * ${depth})` }}
              >
                <span className="location-tree__name">
                  {l.name}
                  {l.code ? <span className="u-muted u-mono"> {l.code}</span> : null}
                </span>
                <StatusPill tone={l.archived ? 'neutral' : 'info'}>
                  {l.archived ? 'Archived' : KIND_LABELS[l.kind]}
                </StatusPill>
                {canEdit ? (
                  <span className="location-tree__actions">
                    {!l.archived && depth + 1 < MAX_DEPTH ? (
                      <Button size="sm" variant="secondary" onClick={() => setDraft(blank(l.id))}>
                        Add inside
                      </Button>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={() => edit(l)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={update.isPending && update.variables?.id === l.id}
                      onClick={() =>
                        update.mutate({
                          id: l.id,
                          version: l.version,
                          body: { archived: !l.archived },
                        })
                      }
                    >
                      {l.archived ? 'Restore' : 'Archive'}
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {update.error && !draft ? (
            <ErrorAlert error={update.error} title="We couldn't change that location" />
          ) : null}
        </Card>
      ) : null}

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit location' : 'Add location'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!draft?.name.trim()} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="stack">
            <ErrorAlert error={saveError} title="We couldn't save the location" />
            <TextField
              label="Name"
              value={draft.name}
              maxLength={120}
              required
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <div className="form-row">
              <Select
                label="Type"
                value={draft.kind}
                options={KIND_OPTIONS}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as LocationTreeKind })}
              />
              <TextField
                label="Code (optional)"
                value={draft.code}
                maxLength={30}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              />
            </div>
            <Select
              label="Inside"
              value={draft.parentId ?? ''}
              placeholder="Top level"
              options={parentOptions}
              onChange={(e) => setDraft({ ...draft, parentId: e.target.value || null })}
            />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
