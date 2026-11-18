// Wording for the pending-sync chip in the tab header.

export function syncBadgeText(c: { pending: number; refused: number }): string | null {
  if (c.refused > 0) {
    const refused = `${c.refused} not accepted`;
    return c.pending > 0 ? `${c.pending} waiting to send, ${refused}` : refused;
  }
  return c.pending > 0 ? `${c.pending} waiting to send` : null;
}
