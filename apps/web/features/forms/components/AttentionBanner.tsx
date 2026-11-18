'use client';

import { Alert } from '@archova/ui';
import type { FormAttention } from '../data/api';

/** Nova's rule-based flags on forms. Advice only: nothing is blocked. */
export function AttentionBanner({ flags }: { flags: readonly FormAttention[] }) {
  if (flags.length === 0) return null;
  return (
    <Alert tone="warning" title="Nova flagged things worth a look">
      <ul className="forms__flags">
        {flags.map((f, i) => (
          <li key={`${f.kind}-${f.formId ?? f.templateId}-${i}`}>{f.message}</li>
        ))}
      </ul>
    </Alert>
  );
}
