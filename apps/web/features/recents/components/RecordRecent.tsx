'use client';

import { useEffect, useRef } from 'react';
import type { RecentViewInput } from '../data/api';
import { useRecordRecent } from '../hooks/useRecents';

/**
 * Renders nothing. Mounted on a record's detail screen, it tells the API once per visit that the person opened the
 * record, so it shows up in the Recents card on the project home. A failed write is ignored: recents are a
 * convenience, never a reason to interrupt the person.
 */
export function RecordRecent(props: RecentViewInput) {
  const { mutate } = useRecordRecent();
  const sent = useRef<string | null>(null);
  const { entityType, entityId, projectId, title, subtitle } = props;

  useEffect(() => {
    const visit = `${entityType}:${entityId}:${title}`;
    if (sent.current === visit) return;
    sent.current = visit;
    mutate({ entityType, entityId, projectId, title, ...(subtitle ? { subtitle } : {}) });
  }, [entityType, entityId, projectId, title, subtitle, mutate]);

  return null;
}
