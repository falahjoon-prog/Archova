'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { MarkupVisibility } from '@archova/markup';
import { webRoutes } from '@archova/routes';
import { Button, Dialog, StatusPill } from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useConfirmPinLocation, useMarkupMutations } from '../hooks/useDrawings';
import type { DrawingMarkup, DrawingPin } from '../lib/types';

const VISIBILITY: Record<
  MarkupVisibility,
  { label: string; tone: 'neutral' | 'info' | 'success' }
> = {
  private: { label: 'Only me', tone: 'neutral' },
  company: { label: 'My company', tone: 'info' },
  project: { label: 'Published', tone: 'success' },
};

const describeShape = (m: DrawingMarkup) =>
  m.shape.kind === 'text'
    ? `Text: “${m.shape.text}”`
    : `${m.shape.kind[0]!.toUpperCase()}${m.shape.kind.slice(1)}`;

/**
 * Pins and markups on the sheet as lists, so everything on the canvas is also reachable by keyboard and screen
 * reader. Publishing a markup to the project is a deliberate, confirmed step (DOC-AC7).
 */
export function SidePanel({
  projectId,
  orgSlug,
  revisionId,
  pins,
  markups,
  actorId,
  timezone,
}: {
  projectId: string;
  orgSlug: string;
  revisionId: string;
  pins: readonly DrawingPin[];
  markups: readonly DrawingMarkup[];
  actorId: string;
  timezone: string;
}) {
  const confirmPin = useConfirmPinLocation(projectId, revisionId);
  const mutations = useMarkupMutations(projectId, revisionId);
  const [publishing, setPublishing] = useState<DrawingMarkup | null>(null);

  const pinHref = (p: DrawingPin) =>
    p.entityType === 'rfi'
      ? webRoutes.rfi(orgSlug, projectId, p.entityId)
      : webRoutes.defect(orgSlug, projectId, p.entityId);

  return (
    <div className="stack">
      <section aria-labelledby="pins-heading">
        <h2 id="pins-heading" className="panel-heading">
          Pinned items ({pins.length})
        </h2>
        {pins.length === 0 ? (
          <p className="u-muted">No RFIs or defects are pinned on this revision.</p>
        ) : (
          <ul className="plain-list">
            {pins.map((p) => (
              <li key={p.id} className="plain-list__item">
                <Link className="link u-mono" href={pinHref(p)}>
                  {p.label}
                </Link>{' '}
                {p.title}
                {p.checkLocation ? (
                  <div className="row-actions">
                    <StatusPill tone="warning">Check location</StatusPill>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={confirmPin.isPending}
                      onClick={() => confirmPin.mutate(p.id)}
                    >
                      Confirm location
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="markups-heading">
        <h2 id="markups-heading" className="panel-heading">
          Markups ({markups.length})
        </h2>
        <ErrorAlert error={mutations.setVisibility.error ?? mutations.remove.error} />
        {markups.length === 0 ? (
          <p className="u-muted">
            No markups you can see. Pick a markup tool, then click twice on the sheet.
          </p>
        ) : (
          <ul className="plain-list">
            {markups.map((m) => {
              const mine = m.ownerId === actorId;
              const v = VISIBILITY[m.visibility];
              return (
                <li key={m.id} className="plain-list__item">
                  <div>
                    {describeShape(m)} <StatusPill tone={v.tone}>{v.label}</StatusPill>
                  </div>
                  <div className="u-caption">
                    {m.ownerName ?? 'Project member'} · {formatInstant(m.createdAt, timezone)}
                  </div>
                  {mine && m.visibility !== 'project' ? (
                    <div className="row-actions">
                      {m.visibility === 'private' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            mutations.setVisibility.mutate({
                              markupId: m.id,
                              visibility: 'company',
                            })
                          }
                        >
                          Share with my company
                        </Button>
                      ) : null}
                      <Button size="sm" variant="secondary" onClick={() => setPublishing(m)}>
                        Publish to project
                      </Button>
                      <Button
                        size="sm"
                        variant="tertiary"
                        onClick={() => mutations.remove.mutate(m.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Dialog
        open={publishing !== null}
        onClose={() => setPublishing(null)}
        title="Publish this markup to the project?"
        description="Everyone on the project will see it, and it becomes part of the project record. You won't be able to delete it afterwards."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPublishing(null)}>
              Cancel
            </Button>
            <Button
              loading={mutations.setVisibility.isPending}
              onClick={() => {
                if (publishing) {
                  mutations.setVisibility.mutate(
                    { markupId: publishing.id, visibility: 'project' },
                    { onSettled: () => setPublishing(null) },
                  );
                }
              }}
            >
              Publish markup
            </Button>
          </>
        }
      />
    </div>
  );
}
