// The worker's side of an induction (design 08 Part B, X58) as the phone flow uses it. Until the `workforce`
// endpoints are in @archova/contracts the preview source serves these shapes; field names follow X58
// (`inductions`, `induction_versions`, `induction_completions`, `worker_credentials`).

export interface InductionSite {
  builderName: string;
  siteName: string;
  /** Not on the link's public summary yet, so only the preview has it. */
  siteAddress: string | null;
  /** Shown on every screen as Help, and when a link no longer works; hidden when unknown. */
  officePhone: string | null;
  /** IANA zone the site's dates and times are shown in (conventions §Time). */
  timeZone: string;
}

/** One thing to read, watch or open inside a section. A section is its blocks in order. */
export type SectionBlock =
  | { type: 'video'; fileId: string; title: string | null }
  | { type: 'slides'; slides: Array<{ title: string; points: string[] }> }
  | { type: 'text'; body: string }
  | { type: 'swms'; documentId: string; title: string; summary?: string[] }
  | { type: 'document'; fileId: string; title: string | null }
  | { type: 'image'; fileId: string; title: string | null; alt?: string };

export interface InductionSection {
  id: string;
  title: string;
  blocks: SectionBlock[];
}

/** Quiz questions as the worker gets them: no answers, which stay on the server. */
export interface QuizQuestion {
  id: string;
  text: string;
  options: Array<{ id: string; text: string }>;
}

export interface QuizResult {
  passed: boolean;
  correct: number;
  total: number;
  /** Correct answers needed: 80% overall by default, never below 70% (IND-AC5). */
  needed: number;
  /** A critical question was wrong: fails whatever the score. */
  missedCritical: boolean;
  /** Sections to look at again, from the questions answered wrongly. */
  reviewSectionIds: string[];
  attempt: number;
  /** After three failed attempts the site manager is told and the worker is sent to the site office. */
  seeSiteOffice: boolean;
}

export type CredentialType = 'white_card' | 'hrwl' | 'trade_licence';

export interface WorkerCredential {
  id: string;
  type: CredentialType;
  /** "White card", "High-risk work licence (EWP)". */
  label: string;
  number: string;
  /** White card: state issued. */
  state: string | null;
  expiry: string | null;
  /** "recorded" until a site manager has checked it ("sighted"); never "verified" (IND-AC7). */
  status: 'recorded' | 'sighted';
  hasPhoto: boolean;
}

export interface WorkerInduction {
  id: string;
  name: string;
  version: number;
  publishedAt: string;
  /** Unknown until the content is read, which is after verification against the API. */
  estimatedMinutes: number | null;
  /** Sections arrive once the mobile is verified (the link's public summary has only the count). */
  sectionCount: number;
  sections: InductionSection[];
  quiz: { questionCount: number; passPercent: number };
  /** Licence types the builder asks for, listed first on B5. */
  requiredLicences: string[];
  declaration: string[];
}

export interface SectionProgress {
  complete: boolean;
}

export interface InductionProgress {
  verified: boolean;
  worker: { name: string; companyName: string; mobileMasked: string } | null;
  /** Matched by mobile to an earlier induction elsewhere: credentials on file are reused (design 08 B2). */
  returning: boolean;
  sections: Record<string, SectionProgress>;
  quiz: { passed: boolean; attempts: number };
  credentials: WorkerCredential[];
  completion: {
    completedAt: string;
    version: number;
  } | null;
}

export type OpenedInduction =
  | {
      state: 'open';
      /** Preview only: stands in for the `__Host-lnk` cookie the API sets. Empty against the API. */
      sessionId: string;
      site: InductionSite;
      induction: WorkerInduction;
      companies: Array<{ id: string; name: string }>;
      progress: InductionProgress;
    }
  | { state: 'expired' | 'revoked'; site: InductionSite | null };

export interface WorkerDetails {
  name: string;
  /** From the project directory, or typed when it isn't listed (flagged to the site manager). */
  companyId: string | null;
  companyName: string;
  mobile: string;
}

export type FlowStep =
  | { kind: 'welcome' }
  | { kind: 'details' }
  | { kind: 'section'; index: number }
  | { kind: 'quiz' }
  | { kind: 'credentials' }
  | { kind: 'declaration' }
  | { kind: 'done' };

export type OpenInduction = Extract<OpenedInduction, { state: 'open' }>;
