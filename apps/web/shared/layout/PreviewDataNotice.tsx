import { Alert } from '@archova/ui';

/**
 * Shown on screens whose module isn't connected to the API yet, so nobody mistakes sample data for a real
 * project. Removed per feature when its data source switches to the generated client.
 */
export function PreviewDataNotice({ tool }: { tool: string }) {
  return (
    <Alert tone="info" title="Sample data">
      {tool} isn&apos;t connected to the server yet. You&apos;re seeing synthetic records, and
      changes last until you reload the page.
    </Alert>
  );
}
