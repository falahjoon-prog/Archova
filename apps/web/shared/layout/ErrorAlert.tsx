import { Alert } from '@archova/ui';
import { toErrorView } from '../lib/errors';

/** Standard treatment for a failed request: the problem `detail`, plus the trace id for support. */
export function ErrorAlert({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  const view = toErrorView(error);
  return (
    <Alert tone="danger" title={title}>
      <p className="u-m-0">{view.message}</p>
      {view.traceId ? <p className="u-m-0 u-caption">Reference: {view.traceId}</p> : null}
    </Alert>
  );
}
