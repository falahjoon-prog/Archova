'use client';

import { Alert, Button } from '@archova/ui';
import { toErrorView } from '../lib/errors';
import { useErrorHelp } from '../providers/ErrorHelpProvider';

/**
 * Standard treatment for a failed request: the problem `detail`, plus the trace id for support. Inside a signed-in
 * organisation it also offers to ask Nova what went wrong and what to do about it.
 */
export function ErrorAlert({ error, title }: { error: unknown; title?: string }) {
  const askHelp = useErrorHelp();
  if (!error) return null;
  const view = toErrorView(error);
  return (
    <Alert tone="danger" title={title}>
      <p className="u-m-0">{view.message}</p>
      {view.traceId ? <p className="u-m-0 u-caption">Reference: {view.traceId}</p> : null}
      {askHelp ? (
        <p className="u-m-0">
          <Button variant="tertiary" size="sm" onClick={() => askHelp(view)}>
            Ask Nova what to do
          </Button>
        </p>
      ) : null}
    </Alert>
  );
}
