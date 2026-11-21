export function planSubtitle(p: {
  numberLabel: string;
  status: string;
  location: string | null;
  signedCount: number;
  crewCount: number;
}): string {
  return [
    p.numberLabel,
    p.status === 'closed' ? 'Closed' : 'Open',
    p.location,
    `${p.signedCount} of ${p.crewCount} signed`,
  ]
    .filter(Boolean)
    .join(', ');
}
