/** Polite loading text for a region; screen readers hear it once. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="u-muted">
      {label}
    </p>
  );
}
