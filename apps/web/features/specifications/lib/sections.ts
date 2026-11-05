// Pasting a section list: one section per line, "03 30 00, Cast-in-place concrete, 4-20".
// Pure, so the rules are tested without a screen.
import type { SpecSectionInput } from '../data/api';

export interface ParsedSections {
  sections: SpecSectionInput[];
  /** Lines that could not be read, with their 1-based line number. */
  problems: { line: number; text: string; why: string }[];
}

/** The last comma-separated part is the pages ("4-20" or "7"); the first is the number; the rest is the title. */
export function parseSections(text: string): ParsedSections {
  const sections: SpecSectionInput[] = [];
  const problems: ParsedSections['problems'] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 3) {
      problems.push({ line: i + 1, text: line, why: 'Use: number, title, pages' });
      return;
    }
    const pages = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(parts[parts.length - 1]!);
    if (!pages) {
      problems.push({ line: i + 1, text: line, why: 'Pages look like 4-20 or 7' });
      return;
    }
    const pageFrom = Number(pages[1]);
    const pageTo = pages[2] ? Number(pages[2]) : pageFrom;
    if (pageFrom < 1 || pageTo < pageFrom) {
      problems.push({ line: i + 1, text: line, why: 'The last page comes before the first' });
      return;
    }
    sections.push({
      sectionNumber: parts[0]!,
      title: parts.slice(1, -1).join(', '),
      pageFrom,
      pageTo,
    });
  });
  return { sections, problems };
}

/** The reverse, to edit what is saved. */
export function sectionsToText(
  sections: readonly { sectionNumber: string; title: string; pageFrom: number; pageTo: number }[],
): string {
  return sections
    .map(
      (s) =>
        `${s.sectionNumber}, ${s.title}, ${s.pageFrom === s.pageTo ? s.pageFrom : `${s.pageFrom}-${s.pageTo}`}`,
    )
    .join('\n');
}

export const pagesText = (s: { pageFrom: number; pageTo: number }) =>
  s.pageFrom === s.pageTo ? `p. ${s.pageFrom}` : `pp. ${s.pageFrom}–${s.pageTo}`;
