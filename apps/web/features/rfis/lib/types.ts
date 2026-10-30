// `rfis.rfis`, `rfis.assignees` and `rfis.responses` (backend schema/rfis-submittals-correspondence.md) as the web
// app uses them. `data/api.ts` maps the API's shapes onto these, so the screens serve both sources.

import type { Citation } from '@archova/ui';

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
  responses: RfiResponse[];
  officialResponseId: string | null;
  activity: RfiActivity[];
  createdAt: string;
  answeredAt: string | null;
  closedAt: string | null;
  /** Server version for If-Match; absent on preview records. */
  version?: number;
}

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

/** Nova output, always a suggestion with sources (P6). */
export interface NovaDraft {
  id: string;
  text: string;
  citations: Citation[];
}

/** Nova's draft of a new RFI from a site note (F3): it fills the form, and the person edits and sends it. */
export interface NovaRfiDraft {
  suggestionId: string;
  subject: string;
  question: string;
  discipline: string | null;
  /** Drawings and spec clauses the question refers to, with the words that make them relevant. */
  references: Array<{
    id: string;
    kind: 'document' | 'drawing' | 'rfi' | 'defect' | 'diary';
    sourceId: string;
    revisionId: string;
    label: string;
    quote: string;
  }>;
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
