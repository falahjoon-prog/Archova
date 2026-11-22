'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Button } from '@archova/ui';
import { listProductUpdates } from '../data/api';
import { pickBanner, readDismissed, writeDismissed } from '../lib/banner';

/** A platform-wide notice from the Archova owner. Dismissing it is remembered in this browser only. */
export function ProductUpdateBanner() {
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => setDismissed(readDismissed()), []);
  const updates = useQuery({
    queryKey: ['product-updates', 'public'],
    queryFn: listProductUpdates,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!dismissed || !updates.data) return null;
  const u = pickBanner(updates.data, dismissed);
  if (!u) return null;
  return (
    <Alert
      tone="info"
      title={u.title}
      action={
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => {
            const next = [...dismissed, u.id];
            setDismissed(next);
            writeDismissed(next);
          }}
        >
          Dismiss
        </Button>
      }
    >
      <p>{u.summary}</p>
      {u.body ? (
        <>
          {open ? u.body.split(/\n{2,}/).map((para) => <p key={para}>{para}</p>) : null}
          <Button
            variant="tertiary"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Show less' : 'Read more'}
          </Button>
        </>
      ) : null}
    </Alert>
  );
}
