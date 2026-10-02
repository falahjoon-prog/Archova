// `diary.*` (backend schema/field.md) as the web app uses it: one entry per project per project-local day, child
// lines with their own ids, amendments as append-only evidence (X42). `data/api.ts` maps the API's shapes onto
// these, so the screens serve both sources.

import type { LocalDate } from '@archova/time';

export type DiaryStatus = 'draft' | 'submitted' | 'signed_off';

/** Observations for the day; any value the source didn't report is null. */
export interface Weather {
  /** BOM station used (X44, DIA-AC2). */
  stationId: string | null;
  stationName: string | null;
  minC: number | null;
  maxC: number | null;
  rainMm: number | null;
  windKmh: number | null;
  conditions: { at7am: string | null; at12pm: string | null; at3pm: string | null };
}

export interface StandDown {
  active: boolean;
  start: string | null;
  end: string | null;
  companyIds: string[];
}

export interface LabourLine {
  id: string;
  companyId: string;
  trade: string;
  /** Blank when copied from yesterday (DIA-AC3), so nobody signs off a number they didn't count. */
  headcount: number | null;
  hours: number | null;
}

export interface PlantLine {
  id: string;
  description: string;
  quantity: number;
  hours: number | null;
  status: 'working' | 'idle' | 'broken_down';
}

export interface DeliveryLine {
  id: string;
  supplier: string;
  description: string;
  docketNumber: string;
  receivedAt: string | null;
}

export interface VisitorLine {
  id: string;
  name: string;
  company: string;
  purpose: string;
}

export const DELAY_TYPES = [
  'weather',
  'client',
  'design',
  'subcontractor',
  'authority',
  'industrial',
  'other',
] as const;
export type DelayType = (typeof DELAY_TYPES)[number];

export const DELAY_TYPE_LABELS: Record<DelayType, string> = {
  weather: 'Weather',
  client: 'Client',
  design: 'Design or late information',
  subcontractor: 'Subcontractor',
  authority: 'Authority',
  industrial: 'Industrial',
  other: 'Other',
};

export interface DelayLine {
  id: string;
  type: DelayType;
  hours: number | null;
  description: string;
  affectedCompanyIds: string[];
  isEotCandidate: boolean;
}

export interface DiaryPhoto {
  id: string;
  caption: string;
  takenAt: string;
}

/** Everything the site manager edits; the part an amendment changes. */
export interface DiaryContent {
  weatherNotes: string;
  standDown: StandDown;
  labour: LabourLine[];
  plant: PlantLine[];
  deliveries: DeliveryLine[];
  visitors: VisitorLine[];
  delays: DelayLine[];
  notes: string;
  photoIds: string[];
}

export interface Amendment {
  id: string;
  reason: string;
  changes: Array<{ field: string; before: string; after: string }>;
  by: string;
  at: string;
}

export interface DiaryEntry {
  date: LocalDate;
  status: DiaryStatus;
  weather: Weather | null;
  content: DiaryContent;
  /** The submitted content before any amendment, kept so the PDF can show both (DIA-AC8). */
  original: DiaryContent | null;
  amendments: Amendment[];
  submittedBy: string | null;
  submittedAt: string | null;
  /** Submitted after the project's cut-off (default 10am next day, DIA-AC7). */
  late: boolean;
  signedOffBy: string | null;
  signedOffAt: string | null;
  /** Photos taken today on this project, offered for attachment (DIA-AC6). */
  photosToday: DiaryPhoto[];
  /** Server version for If-Match; absent on preview records and unsaved days. */
  version?: number;
}

export interface DiaryDaySummary {
  date: LocalDate;
  status: DiaryStatus | 'missing';
  late: boolean;
  amendmentCount: number;
}

export const DIARY_STATUS_LABELS: Record<DiaryStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  signed_off: 'Signed off',
};
