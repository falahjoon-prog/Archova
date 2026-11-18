'use client';

import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import { Button } from '@archova/ui';
import { api } from '@/shared/lib/api';

/** Project home: the chosen project photo as a banner. Shows nothing when none is set or the file is no longer there. */
export function ProjectHero({
  orgId,
  fileId,
  name,
  onRemove,
}: {
  orgId: string;
  fileId: string | null | undefined;
  name: string;
  onRemove?: () => void;
}) {
  const link = useQuery({
    queryKey: ['orgs', orgId, 'files', fileId, 'download'],
    enabled: Boolean(fileId),
    // The signed link lasts 5 minutes; fetch a new one before it lapses.
    staleTime: 3 * 60_000,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/files/{fileId}/download', {
          params: { path: { orgId, fileId: fileId as string } },
        }),
      ),
  });
  if (!fileId || !link.data) return null;
  return (
    <figure className="project-hero">
      {/* Signed storage link, not a static asset, so next/image can't optimise it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="project-hero__img" src={link.data.url} alt={`Photo of ${name}`} />
      {onRemove ? (
        <Button variant="secondary" className="project-hero__remove" onClick={onRemove}>
          Remove photo
        </Button>
      ) : null}
    </figure>
  );
}
