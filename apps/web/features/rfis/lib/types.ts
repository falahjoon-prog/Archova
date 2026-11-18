import type { MarkupShape } from '@archova/markup';

// `rfis.rfis`, `rfis.assignees` and `rfis.responses` (backend schema/rfis-submittals-correspondence.md) as the web
// app uses them. `data/api.ts` maps the API's shapes onto these, so the screens serve both sources.

export const RFI_STATUSES = ['draft', 'open', 'answered', 'closed', 'void'] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];
export type CostImpact = 'yes' | 'no' | 'tbc';

export interface RfiResponse {
  id: string;
  authorId: string;
  authorName: string;
  authorCompanyId: string | null;
  body: string;
  isOfficial: boolean;
  /** Set when the text started as a Nova draft. */
  aiSuggestionId: string | null;
  /** Files attached to the response; photos among them can be marked up. */
  fileIds: string[];
  createdAt: string;
}

export interface RfiActivity {
  id: string;
  actor: string;
  action: string;
  before?: string;
  after?: string;
  detail?: string;
  at: string;
}

export interface Rfi {
  id: string;
  /** Issued on submit; drafts have none (RFI-AC1). */
  number: number | null;
  subject: string;
  question: string;
  status: RfiStatus;
  isPrivate: boolean;
  managerId: string;
  assigneeId: string | null;
  assigneeCompanyId: string | null;
  /** Who holds the ball now; moves on submit, answer and reopen (RFI-AC4). */
  ballInCourtId: string | null;
  ballInCourtCompanyId: string | null;
  /** When the ball last changed hands; null when nobody holds it. */
  ballInCourtSince: string | null;
  /** Company the question came from (a subcontractor's RFI the builder passes on); null when the builder raised it. */
  receivedFromCompanyId: string | null;
  distributionCompanyIds: string[];
  dueDate: string | null;
  costImpact: CostImpact | null;
  scheduleImpactDays: number | null;
  drawing: {
    sheetId: string;
    revisionId: string;
    label: string;
    pin?: { x: number; y: number };
  } | null;
  specSection: string | null;
  location: string | null;
  /** Photos and files on the question itself. */
  fileIds: string[];
  responses: RfiResponse[];
  officialResponseId: string | null;
  activity: RfiActivity[];
  createdAt: string;
  answeredAt: string | null;
  closedAt: string | null;
  /** Server version for If-Match; absent on preview records. */
  version?: number;
}

/** Nova flags an RFI whose ball has sat on the same side this many business days. */
export const STALE_BALL_BUSINESS_DAYS = 5;

export interface RfiInput {
  subject: string;
  question: string;
  assigneeId: string | null;
  dueDate: string | null;
  distributionCompanyIds: string[];
  costImpact: CostImpact | null;
  scheduleImpactDays: number | null;
  drawing: Rfi['drawing'];
  specSection: string | null;
  location: string | null;
  isPrivate: boolean;
  /** Set when the form was filled from a Nova draft, so the RFI records where it started. */
  nova?: { suggestionId: string; subject: string; question: string };
}

/** Nova's rewording of a question, a suggestion until the person accepts it (P6). */
export interface NovaWording {
  id: string;
  text: string;
}

/** A drawing, spec clause or earlier RFI Nova relied on, with the words that make it relevant. */
export interface NovaReference {
  id: string;
  kind: 'document' | 'drawing' | 'rfi' | 'defect' | 'diary';
  sourceId: string;
  revisionId: string;
  label: string;
  quote: string;
}

/** Nova's draft of a response to an RFI that exists: it fills the response box, the person edits and sends (P6). */
export interface NovaDraft {
  id: string;
  text: string;
  /** What the draft rests on; `none` means no document or direction supports it, and the person should know. */
  basis: 'documents' | 'direction' | 'none';
  /** Points the thread and documents leave open, for the person to settle before sending. */
  needsDecision: string[];
  references: NovaReference[];
  unsupportedNumbers: string[];
  /** Files attached to the responses that Nova couldn't use (a scan, a large photo). */
  unreadFiles: string[];
}

/** What Nova drafts a new RFI from: a note, a site photo, a drawing markup, or any mix (F3). */
export interface NovaRfiSource {
  note: string;
  photo?: File | null;
  markup?: { revisionId: string; markupId: string } | null;
}

/** Nova's draft of a new RFI from a site note (F3): it fills the form, and the person edits and sends it. */
export interface NovaRfiDraft {
  suggestionId: string;
  subject: string;
  question: string;
  discipline: string | null;
  /** Drawings and spec clauses the question refers to, with the words that make them relevant. */
  references: NovaReference[];
  /** What a complete RFI states that the note didn't: location, drawing_reference, proposed_solution, impact. */
  gaps: string[];
  unsupportedNumbers: string[];
  similar: Array<{ id: string; number: string | null; subject: string }>;
  drawing: { revisionId: string; label: string; x: number; y: number; scanned: boolean } | null;
}

export const STATUS_LABELS: Record<RfiStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  answered: 'Answered',
  closed: 'Closed',
  void: 'Void',
};

export const formatRfiNumber = (n: number | null) =>
  n === null ? 'Draft' : `RFI-${String(n).padStart(3, '0')}`;

/** An image attached to an RFI (to the question or to a response), with a short-lived link to show it. */
export interface RfiPhoto {
  fileId: string;
  name: string;
  /** Signed or object URL; expires, so it is fetched fresh when the RFI is opened. */
  url: string;
  origin: 'question' | 'response';
}

/** One person's marks on one photo. The photo itself never changes. */
export interface RfiAnnotation {
  id: string;
  fileId: string;
  authorId: string;
  authorName: string;
  shapes: MarkupShape[];
  updatedAt: string;
}

/** Image types every browser draws; other image types (HEIC, TIFF) are kept as files but not marked up here. */
export const MARKABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
