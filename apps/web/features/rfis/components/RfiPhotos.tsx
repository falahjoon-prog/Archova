'use client';

import { useRef } from 'react';
import { Alert, Button } from '@archova/ui';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { usePhotoMutations, useRfiAnnotations, useRfiPhotos } from '../hooks/useRfis';
import type { Rfi } from '../lib/types';
import { PhotoAnnotator } from './PhotoAnnotator';

/**
 * Photos on an RFI and their marks (RFI photo annotation). Each thumbnail shows how many people have marked it;
 * opening one swaps the grid for the annotator, and the open photo is in the URL so a colleague can be sent to it.
 */
export function RfiPhotos({ rfi }: { rfi: Rfi }) {
  const project = useCurrentProject();
  const actor = useActor();
  const photos = useRfiPhotos(project.projectId, rfi);
  const annotations = useRfiAnnotations(project.projectId, rfi.id);
  const m = usePhotoMutations(project.projectId, rfi.id);
  const [params, setParams] = useUrlState(['photo'] as const);
  const input = useRef<HTMLInputElement>(null);
  const closed = rfi.status === 'closed' || rfi.status === 'void';

  const all = annotations.data ?? [];
  const open = photos.data?.find((p) => p.fileId === params.photo) ?? null;

  if (open)
    return (
      <PhotoAnnotator
        key={open.fileId}
        photo={open}
        layers={all.filter((a) => a.fileId === open.fileId)}
        viewerId={actor.id}
        readOnly={closed}
        saving={m.saveMarks.isPending}
        error={m.saveMarks.error}
        onSave={(shapes) =>
          m.saveMarks.mutate(
            { fileId: open.fileId, shapes },
            { onSuccess: () => setParams({ photo: null }) },
          )
        }
        onClose={() => {
          m.saveMarks.reset();
          setParams({ photo: null });
        }}
      />
    );

  return (
    <section aria-labelledby="rfi-photos" className="stack">
      <div className="rfi-photos__head">
        <h2 id="rfi-photos" className="panel-heading u-m-0">
          Photos{photos.data?.length ? ` (${photos.data.length})` : ''}
        </h2>
        {closed ? null : (
          <>
            <input
              ref={input}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              aria-label="Add a photo"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) m.add.mutate(file);
              }}
            />
            <Button
              variant="secondary"
              disabled={m.add.isPending}
              onClick={() => input.current?.click()}
            >
              {m.add.isPending ? 'Adding…' : 'Add photo'}
            </Button>
          </>
        )}
      </div>
      <ErrorAlert error={m.add.error ?? photos.error} title="We couldn't add that photo" />
      {photos.isPending ? (
        <p className="u-muted" role="status">
          Loading photos…
        </p>
      ) : photos.data?.length ? (
        <ul className="rfi-photos__grid">
          {photos.data.map((p) => {
            const layers = all.filter((a) => a.fileId === p.fileId);
            const marks = layers.reduce((n, l) => n + l.shapes.length, 0);
            return (
              <li key={p.fileId}>
                <button
                  type="button"
                  className="rfi-photos__tile ac-focusable"
                  onClick={() => setParams({ photo: p.fileId })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage URL */}
                  <img src={p.url} alt="" loading="lazy" className="rfi-photos__img" />
                  <span className="rfi-photos__caption">
                    <span className="rfi-photos__name">{p.name}</span>
                    <span className="u-caption">
                      {marks
                        ? `${marks} ${marks === 1 ? 'mark' : 'marks'} by ${layers.length} ${layers.length === 1 ? 'person' : 'people'}`
                        : closed
                          ? 'No marks'
                          : 'Open to mark up'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Alert tone="info" title="No photos yet">
          {closed
            ? 'Nothing was attached to this RFI.'
            : 'Add a photo of the issue, then circle or point at what you mean. Whoever answers can mark it too.'}
        </Alert>
      )}
    </section>
  );
}
