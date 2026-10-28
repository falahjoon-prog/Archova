// What the worker screens need from a source. The preview store and the API (`api.ts`) both implement it, so a
// screen never knows which one it has. `sessionId` is the preview's stand-in for the `__Host-lnk` cookie and is
// ignored against the API.

import type {
  InductionProgress,
  OpenInduction,
  OpenedInduction,
  QuizQuestion,
  QuizResult,
  WorkerCredential,
  WorkerDetails,
} from '../lib/types';

export type { OpenInduction };

export interface InductionSource {
  /** Exchanges the link token (or, for `continue`, the session already on this browser) for the induction. */
  open(token: string, storedSessionId: string | null): Promise<OpenedInduction>;
  /** B2: sends a 6-digit code by SMS, or by email as the fallback. */
  sendCode(
    sessionId: string,
    details: WorkerDetails,
    channel: { kind: 'sms' } | { kind: 'email'; email: string },
  ): Promise<{ sentTo: string }>;
  /** Checks the code. The induction's content is released with it, so this returns the whole opened induction. */
  verify(sessionId: string, code: string): Promise<OpenInduction>;
  /** A section was read, watched or opened to the end; `seconds` is the time spent on it. */
  completeSection(
    sessionId: string,
    sectionId: string,
    seconds: number,
  ): Promise<InductionProgress>;
  quizQuestions(sessionId: string): Promise<QuizQuestion[]>;
  submitQuiz(
    sessionId: string,
    answers: Record<string, string>,
  ): Promise<{ result: QuizResult; progress: InductionProgress }>;
  /** B5: one ticket. The photo is re-encoded on the phone first, which drops its location data. */
  saveCredential(
    sessionId: string,
    input: Omit<WorkerCredential, 'id' | 'status' | 'hasPhoto'> & { photo: Blob | null },
  ): Promise<InductionProgress>;
  /** B6: the declaration and signature. */
  sign(
    sessionId: string,
    input: {
      statementsAccepted: number;
      name: string;
      signature:
        | { method: 'drawn'; strokes: Array<Array<{ x: number; y: number }>> }
        | { method: 'typed'; name: string };
      deviceTime: string;
    },
  ): Promise<InductionProgress>;
  /** A short-lived address for a video, PDF or image the induction uses. */
  fileUrl(fileId: string): Promise<string>;
}
