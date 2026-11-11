'use client';

import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tabs,
  TextField,
} from '@archova/ui';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { PhotoDialog } from '../components/PhotoDialog';
import { PhotoGrid } from '../components/PhotoGrid';
import { usePhotoAlbums, usePhotoFeed, usePhotoMutations } from '../hooks/usePhotos';
import {
  CATEGORY_LABELS,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  photoInstant,
  type PhotoCategory,
  type SitePhoto,
} from '../lib/types';

const TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'albums', label: 'Albums' },
] as const;

/**
 * Site photos: a feed, a timeline by day, and albums. Albums fill themselves from where each photo was taken or
 * attached (diary, punch list, inspections, RFIs) and from what is marked up on it; anything unfiled for a day is
 * flagged by Nova with a suggested home.
 */
export function PhotosScreen() {
  const project = useCurrentProject();
  const [params, setParams] = useUrlState(['view', 'album', 'q'] as const);
  const view = TABS.some((t) => t.id === params.view) ? params.view : 'albums';
  const album = params.album;
  const [open, setOpen] = useState<SitePhoto | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { upload } = usePhotoMutations();
  const [uploadError, setUploadError] = useState<string | null>(null);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'photos', id: album || 'all' },
  });

  const onPick = async (files: FileList | null) => {
    setUploadError(null);
    for (const f of Array.from(files ?? [])) {
      if (!PHOTO_TYPES.split(',').includes(f.type) || f.size > PHOTO_MAX_BYTES) {
        setUploadError(`${f.name} isn't a JPEG, PNG or WebP photo under 25 MB.`);
        continue;
      }
      try {
        await upload.mutateAsync(f);
      } catch {
        setUploadError(`${f.name} couldn't be uploaded. Try again.`);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <>
      <PageHeader
        eyebrow="Site"
        title="Photos"
        description="Every site photo in one place. Albums file themselves from the diary, punch list, inspections and RFIs, and from what's marked up on a photo."
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept={PHOTO_TYPES}
              multiple
              hidden
              aria-label="Add photos"
              onChange={(e) => void onPick(e.target.files)}
            />
            <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? 'Uploading…' : 'Add photos'}
            </Button>
          </>
        }
      />
      {uploadError ? <Alert tone="danger" title={uploadError} /> : null}
      <Tabs
        label="Photo views"
        tabs={TABS}
        value={view}
        onValueChange={(id) => setParams({ view: id, album: null })}
      >
        {view === 'albums' && !album ? (
          <AlbumsPanel onOpenAlbum={(a) => setParams({ album: a })} />
        ) : (
          <>
            {album ? (
              <p>
                <Button variant="tertiary" size="sm" onClick={() => setParams({ album: null })}>
                  ← All albums
                </Button>
              </p>
            ) : null}
            <FeedPanel
              view={view === 'timeline' ? 'timeline' : 'feed'}
              album={album}
              q={params.q}
              onSearch={(q) => setParams({ q })}
              timeZone={project.timezone}
              onOpen={setOpen}
            />
          </>
        )}
      </Tabs>
      <PhotoDialog photo={open} timeZone={project.timezone} onClose={() => setOpen(null)} />
    </>
  );
}

function AlbumsPanel({ onOpenAlbum }: { onOpenAlbum: (album: string) => void }) {
  const albums = usePhotoAlbums();
  const m = usePhotoMutations();
  const [name, setName] = useState('');
  const flagged = albums.data?.auto.find((a) => a.category === 'unclassified')?.needsReview ?? 0;
  return (
    <div className="stack">
      <ErrorAlert error={albums.error} title="We couldn't load the albums" />
      {albums.isPending ? <SkeletonRows rows={3} label="Loading albums…" /> : null}
      {flagged > 0 ? (
        <Alert
          tone="warning"
          title={`Nova: ${flagged} photo${flagged === 1 ? ' has' : 's have'} been unfiled for over a day`}
        >
          <Button size="sm" variant="secondary" onClick={() => onOpenAlbum('unclassified')}>
            Review them
          </Button>
        </Alert>
      ) : null}
      {albums.data ? (
        <ul className="album-grid" aria-label="Albums">
          {albums.data.auto.map((a) => (
            <AlbumTile
              key={a.category}
              title={CATEGORY_LABELS[a.category]}
              count={a.count}
              note={a.needsReview > 0 ? `${a.needsReview} need filing` : undefined}
              cover={a.cover?.url}
              onOpen={() => onOpenAlbum(a.category)}
            />
          ))}
          {albums.data.own.map((a) => (
            <AlbumTile
              key={a.id}
              title={a.name}
              count={a.count}
              onOpen={() => onOpenAlbum(a.id)}
              onDelete={() => m.deleteAlbum.mutate(a.id)}
            />
          ))}
        </ul>
      ) : null}
      <Card title="Create album">
        <form
          className="photo-album-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) m.createAlbum.mutate(name.trim(), { onSuccess: () => setName('') });
          }}
        >
          <TextField
            label="Album name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim() || m.createAlbum.isPending}>
            Create album
          </Button>
        </form>
        <ErrorAlert
          error={m.createAlbum.error ?? m.deleteAlbum.error}
          title="We couldn't change the albums"
        />
      </Card>
    </div>
  );
}

function AlbumTile({
  title,
  count,
  note,
  cover,
  onOpen,
  onDelete,
}: {
  title: string;
  count: number;
  note?: string;
  cover?: string;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="album-tile">
      <button
        type="button"
        className="album-tile__open"
        onClick={onOpen}
        aria-label={`Open ${title}, ${count} photos`}
      >
        <span className="album-tile__cover">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover ? <img src={cover} alt="" loading="lazy" /> : null}
        </span>
        <span className="album-tile__title">{title}</span>
        <span className="u-caption">
          {count} photo{count === 1 ? '' : 's'}
          {note ? ` · ${note}` : ''}
        </span>
      </button>
      {onDelete ? (
        <Button
          variant="tertiary"
          size="sm"
          onClick={onDelete}
          aria-label={`Delete album ${title}`}
        >
          Delete
        </Button>
      ) : null}
    </li>
  );
}

function FeedPanel({
  view,
  album,
  q,
  onSearch,
  timeZone,
  onOpen,
}: {
  view: 'feed' | 'timeline';
  album: string;
  q: string;
  onSearch: (q: string) => void;
  timeZone: string;
  onOpen: (p: SitePhoto) => void;
}) {
  const feed = usePhotoFeed({ album: album || undefined, q: q || undefined });
  const photos = feed.data?.pages.flatMap((p) => p.data) ?? [];
  const title = album ? (CATEGORY_LABELS[album as PhotoCategory] ?? 'Album') : 'All photos';
  const days = new Map<string, SitePhoto[]>();
  if (view === 'timeline')
    for (const p of photos) {
      const day = formatInstant(photoInstant(p), timeZone).split(',')[0] ?? '';
      days.set(day, [...(days.get(day) ?? []), p]);
    }
  return (
    <div className="stack">
      <TextField
        label="Search photos"
        value={q}
        placeholder="File name"
        onChange={(e) => onSearch(e.target.value)}
      />
      <ErrorAlert error={feed.error} title="We couldn't load the photos" />
      {feed.isPending ? <SkeletonRows rows={3} label="Loading photos…" /> : null}
      {feed.data && photos.length === 0 ? (
        <EmptyState
          title={q ? 'No photos match that search' : `No photos in ${title} yet`}
          description="Photos added to the diary, punch list, inspections and RFIs show up here, or add some with Add photos."
        />
      ) : null}
      {view === 'timeline'
        ? [...days].map(([day, group]) => (
            <section key={day} aria-label={day} className="stack">
              <h2 className="u-subheading">{day}</h2>
              <PhotoGrid
                photos={group}
                timeZone={timeZone}
                onOpen={onOpen}
                label={`Photos on ${day}`}
              />
            </section>
          ))
        : photos.length > 0 && (
            <PhotoGrid photos={photos} timeZone={timeZone} onOpen={onOpen} label={title} />
          )}
      {feed.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => void feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
        >
          {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
