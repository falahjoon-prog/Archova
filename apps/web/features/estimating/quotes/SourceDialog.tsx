'use client';

import { Button, Dialog } from '@archova/ui';
import type { SourceRef } from '../lib/quote-types';

export interface SourceTarget {
  fileName: string;
  label: string;
  ref: SourceRef;
}

/**
 * Where a value came from in the uploaded quote (EST-AC5). Production opens the quote PDF side by side with the
 * line highlighted; the preview shows the page and the text Nova read.
 */
export function SourceDialog({
  target,
  onClose,
}: {
  target: SourceTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target ? `${target.fileName}, page ${target.ref.page}` : ''}
      description={target ? `Source of “${target.label}”` : undefined}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {target ? (
        <blockquote className="source-snippet">
          <mark>{target.ref.snippet}</mark>
        </blockquote>
      ) : null}
    </Dialog>
  );
}
