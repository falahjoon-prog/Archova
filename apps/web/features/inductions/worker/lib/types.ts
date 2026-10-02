// The worker's side of an induction (design 08 Part B, X58) as the phone flow uses it. Until the `workforce`
// endpoints are in @archova/contracts the preview source serves these shapes; field names follow X58
// (`inductions`, `induction_versions`, `induction_completions`, `worker_credentials`).

export interface InductionSite {
  builderName: string;
  siteName: string;
  siteAddress: string;
  /** Shown on every screen as Help, and when a link no longer works. */
  officePhone: string;
  /** IANA zone the site's dates and times are shown in (conventions §Time). */
  timeZone: string;
}

interface SectionBase {
  id: string;
  title: string;
  minutes: number;
}

export type InductionSection = SectionBase &
  (
    | {
        type: 'video';
        src: string;
        lowDataSrc: string;
        captionsSrc: string;
        transcript: string;
        durationS: number;
      }
    | { type: 'slides'; pages: Array<{ heading: string; body: string }> }
    | { type: 'text'; blocks: Array<{ kind: 'h' | 'p' | 'li'; text: string }> }
    | { type: 'swms'; documents: Array<{ id: string; title: string; summary: string[] }> }
    | { type: 'site_map'; imageSrc: string; alt: string; description: string }
  );

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
  estimatedMinutes: number;
  sections: InductionSection[];
  quiz: { questionCount: number; passPercent: number };
  /** Licence types the builder asks for, listed first on B5. */
  requiredLicences: string[];
  declaration: string[];
}

export interface SectionProgress {
  complete: boolean;
  /** Video: furthest point the server accepted. */
  watchedS?: number;
  /** Slides: pages seen. */
  pagesSeen?: number[];
  /** SWMS: documents opened. */
  opened?: string[];
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
    /** SHA-256 of the exact version content signed (X58). */
    versionHash: string;
    signatureMethod: 'drawn' | 'typed';
  } | null;
}

export type OpenedInduction =
  | {
      state: 'open';
      /** Stand-in for the scoped guest session cookie the API sets on exchange. */
      sessionId: string;
      site: InductionSite;
      induction: WorkerInduction;
      companies: Array<{ id: string; name: string }>;
      progress: InductionProgress;
    }
  | { state: 'expired' | 'revoked'; site: InductionSite };

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
