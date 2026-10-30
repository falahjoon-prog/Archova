// F33 I2 (ai/12 §1): is an induction Nova drafted still in step with the documents it cited? Pure functions: which
// documents and drawing sheets a draft cites, and, given what the register says now, which of them have a newer
// revision or are gone. The register is read on request rather than on a document event, so the answer is never
// behind and no event can be missed.
import { INDUCTION_SECTIONS, type InductionSection } from '@archova/ai-prompts';

/** The part of a stored `induction.draft` payload this reads. */
export interface CitingDraft {
  sections: Array<{
    section: InductionSection;
    slides: Array<{
      points: Array<{ citations: DraftCitationRef[] }>;
      script: Array<{ citations: DraftCitationRef[] }>;
    }>;
  }>;
  quiz: Array<{ section: InductionSection; citations: DraftCitationRef[] }>;
}

export interface DraftCitationRef {
  sourceType: string;
  sourceId: string;
  revisionId: string | null;
  title: string;
}

/** A document or drawing sheet a draft cites, with the revisions it cited and where. */
export interface CitedSource {
  sourceType: 'document' | 'drawing';
  sourceId: string;
  /** The title as it was when cited. */
  title: string;
  revisionIds: string[];
  sections: InductionSection[];
  quizQuestions: number;
}

/** One published revision of a source, as `documents.api.aiSources` reports it. */
export interface LiveRevision {
  revisionId: string;
  revisionLabel: string;
  title: string;
  status: 'current' | 'superseded';
  accessScope: string;
}

export interface SourceChange {
  sourceType: 'document' | 'drawing';
  sourceId: string;
  title: string;
  /** The revision the draft cited, as the register labels it (null when that revision is no longer listed). */
  citedRevision: string | null;
  /** The revision that is current now (null when the source is gone). */
  currentRevision: string | null;
  reason: 'newer_revision' | 'withdrawn';
  sections: InductionSection[];
  quizQuestions: number;
}

/**
 * Documents and drawing sheets the draft cites. RFIs, defects and diary days are left out: they have no revisions, and
 * an induction rarely rests on one.
 */
export function citedSources(draft: CitingDraft): CitedSource[] {
  const bySource = new Map<string, CitedSource>();
  const note = (c: DraftCitationRef, section: InductionSection) => {
    if ((c.sourceType !== 'document' && c.sourceType !== 'drawing') || !c.revisionId) return;
    let s = bySource.get(c.sourceId);
    if (!s) {
      s = {
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        title: c.title,
        revisionIds: [],
        sections: [],
        quizQuestions: 0,
      };
      bySource.set(c.sourceId, s);
    }
    if (!s.revisionIds.includes(c.revisionId)) s.revisionIds.push(c.revisionId);
    if (!s.sections.includes(section)) s.sections.push(section);
  };
  for (const sec of draft.sections)
    for (const slide of sec.slides)
      for (const item of [...slide.points, ...slide.script])
        for (const c of item.citations) note(c, sec.section);
  for (const q of draft.quiz) {
    // A question counts once for a source, however many of its citations name it.
    const seen = new Set<string>();
    for (const c of q.citations) {
      note(c, q.section);
      if (!seen.has(c.sourceId) && bySource.has(c.sourceId)) {
        seen.add(c.sourceId);
        bySource.get(c.sourceId)!.quizQuestions += 1;
      }
    }
  }
  return [...bySource.values()];
}

/**
 * Which cited sources have changed since, given every live revision of each. A change is reported only when the
 * caller may open the source (`readable` holds access scopes as `documents.api.aiAccessScopes` gives them): the
 * register read is permission-free, so a title or revision label must not reach someone who could not have opened the
 * document. Those changes are counted in `hidden` instead, so the answer is still "not up to date".
 */
export function compareSources(
  cited: readonly CitedSource[],
  live: ReadonlyMap<string, readonly LiveRevision[]>,
  readable: ReadonlySet<string>,
): { changed: SourceChange[]; hidden: number; hiddenSections: InductionSection[] } {
  const changed: SourceChange[] = [];
  let hidden = 0;
  const hiddenSections = new Set<InductionSection>();
  for (const c of cited) {
    const revisions = live.get(c.sourceId) ?? [];
    const current = revisions.find((r) => r.status === 'current');
    const stale = !current || c.revisionIds.some((id) => id !== current.revisionId);
    if (!stale) continue;
    const scope = current?.accessScope ?? revisions[0]?.accessScope;
    // A source that is gone has no scope to check: it was cited, so the draft's own reader could open it then.
    if (scope !== undefined && !readable.has(scope)) {
      hidden += 1;
      for (const section of c.sections) hiddenSections.add(section);
      continue;
    }
    const citedLabel = revisions.find((r) => c.revisionIds.includes(r.revisionId))?.revisionLabel;
    changed.push({
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      title: current?.title ?? c.title,
      citedRevision: citedLabel ?? null,
      currentRevision: current?.revisionLabel ?? null,
      reason: current ? 'newer_revision' : 'withdrawn',
      sections: [...c.sections],
      quizQuestions: c.quizQuestions,
    });
  }
  return { changed, hidden, hiddenSections: inOrder(hiddenSections) };
}

const inOrder = (sections: ReadonlySet<InductionSection>): InductionSection[] =>
  INDUCTION_SECTIONS.filter((s) => sections.has(s));

export interface RefreshPlan {
  /** Sections to redraft: they rest on a changed source the caller can open and on no other the caller cannot. */
  refresh: InductionSection[];
  /** Sections left as they are because they also rest on a changed source the caller cannot open. */
  skipped: InductionSection[];
}

/**
 * Which sections a refresh redrafts (ai/12 §1 I2). Nova redrafts only from what the caller may open, so a section that
 * also rests on a changed source they cannot open is left alone: a redraft without that source would quietly drop what
 * it said. The caller is told which sections were left, never why.
 */
export function planRefresh(
  changed: readonly SourceChange[],
  hiddenSections: readonly InductionSection[],
): RefreshPlan {
  const affected = new Set(changed.flatMap((c) => c.sections));
  const hidden = new Set(hiddenSections);
  return {
    refresh: INDUCTION_SECTIONS.filter((s) => affected.has(s) && !hidden.has(s)),
    skipped: INDUCTION_SECTIONS.filter((s) => hidden.has(s)),
  };
}
