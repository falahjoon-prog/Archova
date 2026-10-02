// The worker's induction flow against a preview store, with the interface the `workforce` endpoints will have
// (X58, frontend 11 §3–4): open an X45 link, verify by code, report section progress, take the quiz, save tickets
// and sign. The rules that the server owns live here too, so the screens can't decide them: a video counts once
// watched to the end, answers are checked here and never sent to the screen, and the signature is tied to a hash
// of the exact version shown. Data is synthetic.

import { delay, mockId, nowIso, problem } from '@/shared/mocks/runtime';
import type {
  InductionProgress,
  InductionSite,
  OpenedInduction,
  QuizQuestion,
  QuizResult,
  WorkerCredential,
  WorkerDetails,
  WorkerInduction,
} from '../lib/types';
import { isAuMobile, maskMobile } from '../lib/flow';

/** The preview's one-time code; production sends a real one by SMS or email. */
export const PREVIEW_CODE = '123456';
/** A mobile that has done an induction on another site: welcomed back, white card already on file. */
export const PREVIEW_RETURNING_MOBILE = '0400 000 111';

const SITE: InductionSite = {
  builderName: 'Harbour Builders',
  siteName: 'Harbour St Tower',
  siteAddress: '12 Harbour St, Sydney NSW 2000',
  officePhone: '02 9000 0000',
  timeZone: 'Australia/Sydney',
};

const COMPANIES = [
  { id: 'cmp_elec', name: 'Brightwire Electrical' },
  { id: 'cmp_plumb', name: 'Clearflow Plumbing' },
  { id: 'cmp_tile2', name: 'Harbour Tile Co' },
  { id: 'cmp_form', name: 'Northside Formwork' },
];

const INDUCTION: WorkerInduction = {
  id: 'ind_hst',
  name: 'Harbour St Tower site induction',
  version: 4,
  publishedAt: '2026-09-28T23:00:00Z',
  estimatedMinutes: 20,
  quiz: { questionCount: 5, passPercent: 80 },
  requiredLicences: [],
  declaration: [
    'I have done this induction and understood it.',
    'I am fit for work.',
    'I will follow the site rules and my SWMS.',
  ],
  sections: [
    {
      id: 'sec_welcome',
      type: 'video',
      title: 'Welcome to Harbour St Tower',
      minutes: 1,
      src: '/preview/induction/welcome.webm',
      lowDataSrc: '/preview/induction/welcome-low.webm',
      captionsSrc: '/preview/induction/welcome.vtt',
      durationS: 24,
      transcript:
        'Welcome to Harbour St Tower. Sign in at the gate every day, and sign out when you leave. Wear a hard hat, high-vis, safety boots and eye protection at all times. If the alarm sounds, stop work and go to the assembly point at the Harbour St gate.',
    },
    {
      id: 'sec_emergency',
      type: 'slides',
      title: 'Emergency procedures',
      minutes: 3,
      pages: [
        {
          heading: 'If the alarm sounds',
          body: 'Stop work. Make your area safe if you can do it quickly. Walk, do not run, to the assembly point.',
        },
        {
          heading: 'Assembly point',
          body: 'The assembly point is the green A sign inside the Harbour St gate. Stay there until a warden says you can leave.',
        },
        {
          heading: 'Fire',
          body: 'Raise the alarm. Only use an extinguisher if you are trained and the fire is small. Call 000 if no one has.',
        },
      ],
    },
    {
      id: 'sec_rules',
      type: 'text',
      title: 'Site rules',
      minutes: 3,
      blocks: [
        {
          kind: 'p',
          text: 'These rules keep everyone safe. Breaking them can mean leaving the site.',
        },
        { kind: 'li', text: 'Sign in at the gate every day. Sign out when you leave.' },
        { kind: 'li', text: 'Work hours are 7:00 am to 5:00 pm, Monday to Friday.' },
        { kind: 'li', text: 'No alcohol or drugs. You may be tested.' },
        { kind: 'li', text: 'Smoke only in the marked area next to the lunch room.' },
        { kind: 'li', text: 'Keep walkways clear. Put rubbish in the bins.' },
      ],
    },
    {
      id: 'sec_ppe',
      type: 'text',
      title: 'PPE and hazards',
      minutes: 4,
      blocks: [
        { kind: 'h', text: 'Always wear' },
        { kind: 'li', text: 'Hard hat, high-vis shirt or vest, safety boots and safety glasses.' },
        { kind: 'h', text: 'Main hazards on this site' },
        {
          kind: 'li',
          text: 'Crane lifts: never walk under a load. Keep out of the crane zone when the bell rings.',
        },
        {
          kind: 'li',
          text: 'Working at heights: use the handrails and harness points. Report missing edge protection.',
        },
        {
          kind: 'li',
          text: 'Electrical: only licensed electricians touch switchboards and leads.',
        },
      ],
    },
    {
      id: 'sec_firstaid',
      type: 'text',
      title: 'First aid, amenities and reporting',
      minutes: 2,
      blocks: [
        {
          kind: 'li',
          text: 'First aid is in the site office. The first aiders wear a green hard hat.',
        },
        { kind: 'li', text: 'The lunch room and toilets are next to the crane zone fence.' },
        {
          kind: 'li',
          text: 'Report every injury, near miss and hazard to your supervisor the same day.',
        },
      ],
    },
    {
      id: 'sec_swms',
      type: 'swms',
      title: 'SWMS for this site',
      minutes: 4,
      documents: [
        {
          id: 'doc_swms_heights',
          title: 'SWMS 03 Working at heights',
          summary: [
            'Use edge protection or a harness above 2 metres.',
            'Check your harness before each use.',
            'Never remove edge protection. Tell your supervisor if it is missing.',
          ],
        },
        {
          id: 'doc_swms_crane',
          title: 'SWMS 07 Crane lifts',
          summary: [
            'Only the dogman directs the crane.',
            'Keep clear of the lift zone when the bell rings.',
            'Never stand under a suspended load.',
          ],
        },
      ],
    },
    {
      id: 'sec_map',
      type: 'site_map',
      title: 'Site map',
      minutes: 2,
      imageSrc: '/preview/induction/site-map.svg',
      alt: 'Site map of Harbour St Tower',
      description:
        'The gate is on Harbour St, at the bottom of the map. The assembly point, a green A sign, is just inside the gate. The site office and first aid are on the left, the lunch room and toilets on the right. The crane zone is at the top right.',
    },
  ],
};

interface QuizAnswerKey {
  q: QuizQuestion;
  correct: string;
  critical: boolean;
  sectionId: string;
}

const QUIZ: QuizAnswerKey[] = [
  {
    q: {
      id: 'q1',
      text: 'The alarm sounds. Where do you go?',
      options: [
        { id: 'a', text: 'Back to my van' },
        { id: 'b', text: 'The assembly point inside the Harbour St gate' },
        { id: 'c', text: 'The lunch room' },
      ],
    },
    correct: 'b',
    critical: true,
    sectionId: 'sec_emergency',
  },
  {
    q: {
      id: 'q2',
      text: 'What must you wear on site at all times?',
      options: [
        { id: 'a', text: 'Hard hat, high-vis, safety boots and safety glasses' },
        { id: 'b', text: 'Just a hard hat' },
        { id: 'c', text: 'Whatever my supervisor says that day' },
      ],
    },
    correct: 'a',
    critical: true,
    sectionId: 'sec_ppe',
  },
  {
    q: {
      id: 'q3',
      text: 'The crane bell rings. What do you do?',
      options: [
        { id: 'a', text: 'Walk under the load quickly' },
        { id: 'b', text: 'Keep out of the crane zone' },
        { id: 'c', text: 'Wave to the crane driver' },
      ],
    },
    correct: 'b',
    critical: false,
    sectionId: 'sec_ppe',
  },
  {
    q: {
      id: 'q4',
      text: 'Where is first aid?',
      options: [
        { id: 'a', text: 'In the site office' },
        { id: 'b', text: 'In the lunch room' },
        { id: 'c', text: 'There is no first aid' },
      ],
    },
    correct: 'a',
    critical: false,
    sectionId: 'sec_firstaid',
  },
  {
    q: {
      id: 'q5',
      text: 'You see a hazard. When do you report it?',
      options: [
        { id: 'a', text: 'At the end of the week' },
        { id: 'b', text: 'Only if someone gets hurt' },
        { id: 'c', text: 'To my supervisor the same day' },
      ],
    },
    correct: 'c',
    critical: false,
    sectionId: 'sec_firstaid',
  },
];

interface Session {
  id: string;
  details: WorkerDetails | null;
  codeSent: boolean;
  progress: InductionProgress;
}

const TOKENS: Record<string, 'open' | 'expired' | 'revoked'> = {
  demo: 'open',
  expired: 'expired',
  revoked: 'revoked',
};

let sessions = new Map<string, Session>();

const emptyProgress = (): InductionProgress => ({
  verified: false,
  worker: null,
  returning: false,
  sections: {},
  quiz: { passed: false, attempts: 0 },
  credentials: [],
  completion: null,
});

function session(sessionId: string): Session {
  const s = sessions.get(sessionId);
  if (!s)
    problem(
      401,
      'induction.session_expired',
      'This induction session has ended. Open your link again.',
    );
  return s;
}

function verified(sessionId: string): Session {
  const s = session(sessionId);
  if (!s.progress.verified)
    problem(403, 'induction.not_verified', 'Verify your mobile number first.');
  return s;
}

function sectionOf(id: string) {
  const sec = INDUCTION.sections.find((x) => x.id === id);
  if (!sec) problem(404, 'not_found', "We couldn't find that section.");
  return sec;
}

const allSectionsDone = (p: InductionProgress) =>
  INDUCTION.sections.every((sec) => p.sections[sec.id]?.complete);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Quiz pass mark: the builder can raise it, never below 70% (IND-AC5). */
export function correctNeeded(total: number, passPercent: number): number {
  return Math.ceil((total * Math.max(70, passPercent)) / 100);
}

export const inductionSource = {
  /**
   * Exchanges an access link (X45) for a session scoped to this induction. `continue` with a stored session
   * resumes after the token has been taken out of the address bar.
   */
  async open(token: string, storedSessionId: string | null): Promise<OpenedInduction> {
    let s: Session | undefined;
    if (token === 'continue') {
      s = storedSessionId ? sessions.get(storedSessionId) : undefined;
      if (!s) return delay({ state: 'expired', site: SITE });
    } else {
      const state = TOKENS[token] ?? 'expired';
      if (state !== 'open') return delay({ state, site: SITE });
      s = { id: mockId('isn'), details: null, codeSent: false, progress: emptyProgress() };
      sessions.set(s.id, s);
    }
    return delay({
      state: 'open',
      sessionId: s.id,
      site: SITE,
      induction: INDUCTION,
      companies: COMPANIES,
      progress: s.progress,
    });
  },

  /** B2: sends a 6-digit code by SMS, or by email as the fallback. */
  async sendCode(
    sessionId: string,
    details: WorkerDetails,
    channel: { kind: 'sms' } | { kind: 'email'; email: string },
  ): Promise<{ sentTo: string }> {
    const s = session(sessionId);
    if (!details.name.trim()) problem(422, 'validation', 'Enter your full name.');
    if (!details.companyName.trim()) problem(422, 'validation', 'Choose or type your company.');
    if (!isAuMobile(details.mobile))
      problem(422, 'validation', 'Enter an Australian mobile number, like 0412 345 678.');
    if (channel.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(channel.email))
      problem(422, 'validation', 'Enter an email address, like sam@example.com.');
    s.details = details;
    s.codeSent = true;
    return delay({
      sentTo: channel.kind === 'sms' ? maskMobile(details.mobile) : channel.email,
    });
  },

  /** Upgrades the session to verified. A mobile seen before keeps its credentials on file. */
  async verify(sessionId: string, code: string): Promise<InductionProgress> {
    const s = session(sessionId);
    if (!s.codeSent || !s.details) problem(409, 'induction.no_code', 'Send a code first.');
    if (code.trim() !== PREVIEW_CODE)
      problem(
        422,
        'induction.code_invalid',
        "That code isn't right. Check the message and try again.",
      );
    const returning =
      s.details.mobile.replace(/\D/g, '') === PREVIEW_RETURNING_MOBILE.replace(/\D/g, '');
    s.progress.verified = true;
    s.progress.returning = returning;
    s.progress.worker = {
      name: s.details.name.trim(),
      companyName: s.details.companyName.trim(),
      mobileMasked: maskMobile(s.details.mobile),
    };
    if (returning && !s.progress.credentials.length) {
      s.progress.credentials.push({
        id: mockId('wcr'),
        type: 'white_card',
        label: 'White card',
        number: 'CGI 0012345',
        state: 'NSW',
        expiry: null,
        status: 'sighted',
        hasPhoto: true,
      });
    }
    return delay(s.progress);
  },

  /** Video: reports the furthest point watched; the section completes at the end (frontend 11 §4). */
  async reportWatch(
    sessionId: string,
    sectionId: string,
    furthestS: number,
  ): Promise<InductionProgress> {
    const s = verified(sessionId);
    const sec = sectionOf(sectionId);
    if (sec.type !== 'video')
      problem(409, 'induction.wrong_section', 'That section is not a video.');
    const p = (s.progress.sections[sectionId] ??= { complete: false, watchedS: 0 });
    p.watchedS = Math.max(p.watchedS ?? 0, Math.min(furthestS, sec.durationS));
    if (p.watchedS >= sec.durationS - 1) p.complete = true;
    return delay(s.progress);
  },

  /** Slides: each page must be seen. */
  async viewPage(sessionId: string, sectionId: string, page: number): Promise<InductionProgress> {
    const s = verified(sessionId);
    const sec = sectionOf(sectionId);
    if (sec.type !== 'slides')
      problem(409, 'induction.wrong_section', 'That section is not slides.');
    const p = (s.progress.sections[sectionId] ??= { complete: false, pagesSeen: [] });
    p.pagesSeen = [...new Set([...(p.pagesSeen ?? []), page])].sort((a, b) => a - b);
    if (sec.pages.every((_, i) => p.pagesSeen!.includes(i))) p.complete = true;
    return delay(s.progress);
  },

  /** SWMS: each document must be opened. Awareness only, never SWMS sign-on (product 14). */
  async openDocument(
    sessionId: string,
    sectionId: string,
    documentId: string,
  ): Promise<InductionProgress> {
    const s = verified(sessionId);
    const sec = sectionOf(sectionId);
    if (sec.type !== 'swms') problem(409, 'induction.wrong_section', 'That section is not SWMS.');
    const p = (s.progress.sections[sectionId] ??= { complete: false, opened: [] });
    p.opened = [...new Set([...(p.opened ?? []), documentId])];
    if (sec.documents.every((d) => p.opened!.includes(d.id))) p.complete = true;
    return delay(s.progress);
  },

  /** Text and site map: read to the end and pressed Next. */
  async completeSection(sessionId: string, sectionId: string): Promise<InductionProgress> {
    const s = verified(sessionId);
    const sec = sectionOf(sectionId);
    if (sec.type !== 'text' && sec.type !== 'site_map')
      problem(409, 'induction.section_rules', 'Finish this section first.');
    s.progress.sections[sectionId] = { complete: true };
    return delay(s.progress);
  },

  async quizQuestions(sessionId: string): Promise<QuizQuestion[]> {
    const s = verified(sessionId);
    if (!allSectionsDone(s.progress))
      problem(409, 'induction.sections_incomplete', 'Finish every section before the quiz.');
    return delay(QUIZ.map((k) => k.q));
  },

  /** Scores on the server: 80% overall and every critical question right (IND-AC5). Every attempt counts. */
  async submitQuiz(
    sessionId: string,
    answers: Record<string, string>,
  ): Promise<{ result: QuizResult; progress: InductionProgress }> {
    const s = verified(sessionId);
    if (!allSectionsDone(s.progress))
      problem(409, 'induction.sections_incomplete', 'Finish every section before the quiz.');
    const wrong = QUIZ.filter((k) => answers[k.q.id] !== k.correct);
    const total = QUIZ.length;
    const correct = total - wrong.length;
    const needed = correctNeeded(total, INDUCTION.quiz.passPercent);
    const missedCritical = wrong.some((k) => k.critical);
    const passed = correct >= needed && !missedCritical;
    s.progress.quiz.attempts += 1;
    if (passed) s.progress.quiz.passed = true;
    const reviewSectionIds = INDUCTION.sections
      .map((sec) => sec.id)
      .filter((id) => wrong.some((k) => k.sectionId === id));
    return delay({
      result: {
        passed,
        correct,
        total,
        needed,
        missedCritical,
        reviewSectionIds,
        attempt: s.progress.quiz.attempts,
      },
      progress: s.progress,
    });
  },

  /** B5: one ticket. The photo is re-encoded on the phone first, which drops its location data. */
  async saveCredential(
    sessionId: string,
    input: Omit<WorkerCredential, 'id' | 'status' | 'hasPhoto'> & { photo: Blob | null },
  ): Promise<InductionProgress> {
    const s = verified(sessionId);
    if (!input.number.trim()) problem(422, 'validation', 'Enter the number on the card.');
    if (input.type === 'white_card' && !input.state)
      problem(422, 'validation', 'Choose the state that issued your white card.');
    if (input.type !== 'white_card' && !input.expiry)
      problem(422, 'validation', 'Enter the expiry date on the licence.');
    const existing = s.progress.credentials.find(
      (c) => c.type === input.type && (c.type === 'white_card' || c.label === input.label),
    );
    const record: WorkerCredential = {
      id: existing?.id ?? mockId('wcr'),
      type: input.type,
      label: input.label,
      number: input.number.trim(),
      state: input.state,
      expiry: input.expiry,
      status: 'recorded',
      hasPhoto: Boolean(input.photo) || Boolean(existing?.hasPhoto),
    };
    s.progress.credentials = [...s.progress.credentials.filter((c) => c.id !== record.id), record];
    return delay(s.progress);
  },

  /**
   * B6: the declaration and signature. The record holds the typed name, the signature (strokes or typed), the time
   * and a hash of the exact version shown; device time and IP are added by the API from the request (IND-AC6).
   */
  async sign(
    sessionId: string,
    input: {
      statementsAccepted: number;
      name: string;
      signature: { method: 'drawn'; strokes: unknown[] } | { method: 'typed'; name: string };
      deviceTime: string;
    },
  ): Promise<InductionProgress> {
    const s = verified(sessionId);
    if (!allSectionsDone(s.progress) || !s.progress.quiz.passed)
      problem(409, 'induction.not_ready', 'Finish the sections and pass the quiz first.');
    if (!s.progress.credentials.some((c) => c.type === 'white_card'))
      problem(409, 'induction.white_card_missing', 'Add your white card first.');
    if (input.statementsAccepted !== INDUCTION.declaration.length)
      problem(422, 'validation', 'Tick each statement to sign.');
    if (!input.name.trim()) problem(422, 'validation', 'Type your full name.');
    if (input.signature.method === 'drawn' && !input.signature.strokes.length)
      problem(422, 'validation', 'Draw your signature, or use a typed signature.');
    s.progress.completion = {
      completedAt: nowIso(),
      version: INDUCTION.version,
      versionHash: await sha256Hex(JSON.stringify(INDUCTION)),
      signatureMethod: input.signature.method,
    };
    return delay(s.progress);
  },
};

export type InductionSource = typeof inductionSource;

export function resetInductionPreview() {
  sessions = new Map();
}
