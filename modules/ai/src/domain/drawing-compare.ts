// F21 drawing revision compare (ai/01 F21): what changed in a sheet's text between two revisions. Code finds the
// changes, so nothing the model says can add one; the model only puts them into plain words, and every change it
// leaves out is still listed. Text only for now: clouds and linework need the vision pass (ai/01 F21 "Fast
// (vision)"). Pure rules, no IO.
import type { CompareChange, DrawingCompareOutput } from '@archova/ai-prompts';
import { normaliseForMatch } from './citations';
import { numbersIn } from './diary-summary';
import type { TextItem } from './titleblock';

/** A line of text on a sheet, in normalised sheet coordinates (0..1, origin top-left, as pins and markups). */
export interface SheetLine {
  text: string;
  x: number;
  y: number;
}

export interface SheetChange extends CompareChange {
  /** Where the change sits on the new sheet (the old one for a removal), for pins and highlights. */
  x: number;
  y: number;
}

/** Changes sent to the model at most; a sheet with more is summarised from these and says so. */
export const MAX_CHANGES = 200;

/** Groups text items into lines with positions, top to bottom. */
export function sheetLines(
  items: readonly TextItem[],
  page: { width: number; height: number },
): SheetLine[] {
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; tol: number; parts: TextItem[] }[] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= l.tol);
    if (line) line.parts.push(it);
    else lines.push({ y: it.y, tol: Math.max(2, it.height * 0.4), parts: [it] });
  }
  return lines.map((l) => {
    const parts = l.parts.sort((a, b) => a.x - b.x);
    return {
      text: parts.map((p) => p.str.trim()).join('  '),
      x: clamp(parts[0]!.x / page.width),
      y: clamp(1 - l.y / page.height),
    };
  });
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const key = (t: string) => normaliseForMatch(t).replace(/\s+/g, ' ');
const words = (t: string) =>
  key(t)
    .replace(/\d+(?:[.:/,-]\d+)*/g, '#')
    .split(/[^a-z#]+/)
    .filter(Boolean);

/** Title blocks sit bottom-right or down the right edge (as `selectTitleBlockText`). */
const inTitleBlock = (l: SheetLine) => (l.x >= 0.6 && l.y >= 0.65) || l.x >= 0.8;

/** Same wording with different numbers, mostly the same words close by, or an edit in the same spot. */
function likeness(a: SheetLine, b: SheetLine): number {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  if (distance > 0.15) return 0;
  const wa = new Set(words(a.text));
  const wb = new Set(words(b.text));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  if (!union || !shared) return 0;
  // Edited in place (a revision letter, a door type): same spot, some words shared.
  if (distance <= 0.02) return Math.max(0.5, shared / union);
  return shared / union - distance;
}

/**
 * The text changes between two revisions of a sheet: lines removed, added, or changed in place (similar wording
 * nearby, such as a dimension or a note edited). Unchanged lines are matched by text wherever they moved to.
 */
export function diffSheets(
  before: readonly SheetLine[],
  after: readonly SheetLine[],
): { changes: SheetChange[]; truncated: boolean } {
  const left = new Map<string, SheetLine[]>();
  for (const l of before) left.set(key(l.text), [...(left.get(key(l.text)) ?? []), l]);
  const added: SheetLine[] = [];
  for (const l of after) {
    const same = left.get(key(l.text));
    if (same?.length) same.shift();
    else added.push(l);
  }
  const removed = [...left.values()].flat();

  const pairs: Array<{ r: number; a: number; score: number }> = [];
  removed.forEach((r, i) =>
    added.forEach((a, j) => {
      const score = likeness(r, a);
      if (score >= 0.4) pairs.push({ r: i, a: j, score });
    }),
  );
  pairs.sort((p, q) => q.score - p.score);
  const usedR = new Set<number>();
  const usedA = new Set<number>();
  const found: Array<Omit<SheetChange, 'id'>> = [];
  for (const p of pairs) {
    if (usedR.has(p.r) || usedA.has(p.a)) continue;
    usedR.add(p.r);
    usedA.add(p.a);
    const a = added[p.a]!;
    found.push({
      kind: 'changed',
      before: removed[p.r]!.text,
      after: a.text,
      titleBlock: inTitleBlock(a),
      x: a.x,
      y: a.y,
    });
  }
  removed.forEach((r, i) => {
    if (!usedR.has(i))
      found.push({
        kind: 'removed',
        before: r.text,
        after: null,
        titleBlock: inTitleBlock(r),
        x: r.x,
        y: r.y,
      });
  });
  added.forEach((a, j) => {
    if (!usedA.has(j))
      found.push({
        kind: 'added',
        before: null,
        after: a.text,
        titleBlock: inTitleBlock(a),
        x: a.x,
        y: a.y,
      });
  });
  // Drawing body first, then the title block; top to bottom, left to right.
  found.sort((p, q) => Number(p.titleBlock) - Number(q.titleBlock) || p.y - q.y || p.x - q.x);
  return {
    changes: found.slice(0, MAX_CHANGES).map((c, i) => ({ ...c, id: `c${i + 1}` })),
    truncated: found.length > MAX_CHANGES,
  };
}

export interface CompareItem {
  text: string;
  changeIds: string[];
}

export interface ReviewedCompare {
  headline: string;
  items: CompareItem[];
  /** Changes no kept item describes, listed as found so nothing is hidden. */
  unexplained: string[];
  /** Items removed because they cited no real change or stated a number their changes don't contain. */
  dropped: number;
}

/** Keeps only items backed by real changes with numbers from those changes; lists the changes left uncovered. */
export function reviewCompare(
  out: DrawingCompareOutput,
  changes: readonly SheetChange[],
  sheet: { fromRev: string; toRev: string },
): ReviewedCompare {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const covered = new Set<string>();
  const items: CompareItem[] = [];
  let dropped = 0;
  for (const it of out.items) {
    const ids = [...new Set(it.changeIds)].filter((id) => byId.has(id));
    const hay = normaliseForMatch(
      [
        sheet.fromRev,
        sheet.toRev,
        ...ids.flatMap((id) => [byId.get(id)!.before ?? '', byId.get(id)!.after ?? '']),
      ]
        .join('\n')
        .replace(/,/g, ''),
    ).replace(/\s+/g, '');
    if (!ids.length || !numbersIn(it.text).every((n) => hay.includes(n))) {
      dropped++;
      continue;
    }
    ids.forEach((id) => covered.add(id));
    items.push({ text: it.text.trim(), changeIds: ids });
  }
  // A headline with an untraceable number falls back to a plain count.
  const allText = normaliseForMatch(
    [sheet.fromRev, sheet.toRev, ...changes.flatMap((c) => [c.before ?? '', c.after ?? ''])]
      .join('\n')
      .replace(/,/g, ''),
  ).replace(/\s+/g, '');
  const headlineOk = numbersIn(out.headline).every((n) => allText.includes(n));
  return {
    headline: headlineOk
      ? out.headline.trim()
      : `${changes.length} text change${changes.length === 1 ? '' : 's'} from revision ${sheet.fromRev} to ${sheet.toRev}.`,
    items,
    unexplained: changes.filter((c) => !covered.has(c.id)).map((c) => c.id),
    dropped,
  };
}

/** Pins (0..1, top-left) within this distance of a change count as near it. */
export const NEAR_CHANGE = 0.1;

export function isNearChange(pin: { x: number; y: number }, changes: readonly SheetChange[]) {
  return changes.some((c) => !c.titleBlock && Math.hypot(c.x - pin.x, c.y - pin.y) <= NEAR_CHANGE);
}
