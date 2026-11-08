/** "03 30 00 Cast-in-place concrete" */
export const sectionTitle = (s: { sectionNumber: string; title: string }) =>
  `${s.sectionNumber}  ${s.title}`;

/** "Pages 12 to 18", or "Page 12" for a one-page section. */
export function pageText(s: { pageFrom: number; pageTo: number }): string {
  return s.pageFrom === s.pageTo ? `Page ${s.pageFrom}` : `Pages ${s.pageFrom} to ${s.pageTo}`;
}

export function sectionSubtitle(s: {
  pageFrom: number;
  pageTo: number;
  revision: string | null;
}): string {
  return s.revision ? `${pageText(s)}, rev ${s.revision}` : pageText(s);
}

export function bookSubtitle(b: {
  status: 'current' | 'superseded';
  sectionCount: number;
  issuedDate: string | null;
}): string {
  const n = `${b.sectionCount} ${b.sectionCount === 1 ? 'section' : 'sections'}`;
  return [b.status === 'superseded' ? 'Superseded' : null, b.issuedDate, n]
    .filter(Boolean)
    .join(', ');
}

/** Sections grouped by division, in book order, for a headed list. */
export function byDivision<T extends { division: string | null }>(
  sections: readonly T[],
): { division: string; sections: T[] }[] {
  const out: { division: string; sections: T[] }[] = [];
  for (const s of sections) {
    const division = s.division ?? 'Other';
    const last = out[out.length - 1];
    if (last && last.division === division) last.sections.push(s);
    else out.push({ division, sections: [s] });
  }
  return out;
}
