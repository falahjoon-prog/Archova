// Pure rules for meetings: agenda templates, numbering, carry-forward and what an outsider may see (product/07).
import type { LiveSnapshot, LiveSource } from './live';

export const ITEM_KINDS = ['information', 'decision', 'action'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type ItemStatus = 'open' | 'closed';

export const SERIES_TEMPLATES = [
  'site_coordination',
  'pcg',
  'design_coordination',
  'safety_committee',
  'custom',
] as const;
export type SeriesTemplate = (typeof SERIES_TEMPLATES)[number];

export interface AgendaSection {
  title: string;
  internalOnly: boolean;
}

const section = (title: string, internalOnly = false): AgendaSection => ({ title, internalOnly });

/** MTG-AC1: the starting agenda for each series template. Everything is editable afterwards. */
export const AGENDA_TEMPLATES: Record<SeriesTemplate, readonly AgendaSection[]> = {
  site_coordination: [
    section('Safety'),
    section('Programme'),
    section('Design'),
    section('RFIs'),
    section('Submittals'),
    section('Variations'),
    section('Quality'),
    section('General'),
  ],
  pcg: [
    section('Safety'),
    section('Programme'),
    section('Design'),
    section('Variations'),
    section('Quality'),
    section('Builder only: commercial', true),
    section('General'),
  ],
  design_coordination: [
    section('Design'),
    section('RFIs'),
    section('Submittals'),
    section('Programme'),
    section('General'),
  ],
  safety_committee: [
    section('Incidents and near misses'),
    section('Consultation'),
    section('Hazards and controls'),
    section('Actions'),
    section('General'),
  ],
  custom: [section('General')],
};

/** MTG-AC1: items are numbered `section.item`, e.g. 3.2. */
export const itemNumber = (sectionPosition: number, seq: number) => `${sectionPosition}.${seq}`;

/** Decisions and information are recorded, not tracked; only actions start open. */
export const defaultStatus = (kind: ItemKind): ItemStatus =>
  kind === 'action' ? 'open' : 'closed';

/** Nova rule (P2): an action carried this many times is flagged in plain words. */
export const STALE_AFTER_CARRIES = 3;
export const isStale = (i: { kind: ItemKind; status: ItemStatus; carriedCount: number }) =>
  i.kind === 'action' && i.status === 'open' && i.carriedCount >= STALE_AFTER_CARRIES;

export interface CarrySection {
  position: number;
  title: string;
  internalOnly: boolean;
  nextItem: number;
  /** A live section stays live in the next meeting (MTG-US5). */
  liveSource?: LiveSource | null;
}
export interface CarryItem {
  id: string;
  sectionPosition: number;
  threadId: string;
  carriedCount: number;
  status: ItemStatus;
}

/**
 * MTG-AC2: the next meeting starts from the previous one. Its sections are the previous sections (same positions, so
 * item numbers stay put), and every open item comes with it, keeping its number and thread and counting one more carry.
 */
export function carryForward(prev: { sections: CarrySection[]; items: CarryItem[] }) {
  return {
    sections: prev.sections.map((s) => ({ ...s })),
    items: prev.items
      .filter((i) => i.status === 'open')
      .map((i) => ({
        fromId: i.id,
        sectionPosition: i.sectionPosition,
        threadId: i.threadId,
        carriedCount: i.carriedCount + 1,
      })),
  };
}

/** The first meeting of a series starts from the series agenda. */
export const sectionsFromAgenda = (agenda: readonly AgendaSection[]): CarrySection[] =>
  agenda.map((s, i) => ({
    position: i + 1,
    title: s.title,
    internalOnly: s.internalOnly,
    nextItem: 1,
    liveSource: null,
  }));

export interface Viewer {
  userId: string;
  companyId: string | null;
  isInternal: boolean;
}

export interface Party {
  userId?: string | null;
  companyId?: string | null;
}

/** MTG-AC7: an outsider sees minutes they were party to (as an attendee), and only issued ones. */
export const isParty = (viewer: Viewer, parties: readonly Party[]) =>
  parties.some(
    (p) =>
      (p.userId && p.userId === viewer.userId) ||
      (viewer.companyId && p.companyId && p.companyId === viewer.companyId),
  );

export interface MinutesItemView {
  itemNo: string;
  kind: ItemKind;
  body: string;
  status: ItemStatus;
  ownerName: string | null;
  dueDate: string | null;
  carriedCount: number;
}
export interface MinutesView {
  title: string;
  number: number;
  seriesName: string;
  heldAt: string;
  location: string;
  version: number;
  issuedAt: string;
  correctionsBy: string | null;
  attendees: { name: string; companyName: string; role: string; attendance: string }[];
  sections: {
    position: number;
    title: string;
    internalOnly: boolean;
    /** The register list as it stood when the minutes were issued (MTG-AC6). */
    live?: LiveSnapshot | null;
    items: MinutesItemView[];
  }[];
}

/** MTG-AC7: internal-only sections never leave the builder's side. */
export const forAudience = (m: MinutesView, audience: 'internal' | 'external'): MinutesView =>
  audience === 'internal'
    ? m
    : { ...m, sections: m.sections.filter((s) => !s.internalOnly && !s.live) };
