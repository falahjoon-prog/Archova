// The worker's induction flow against a preview store, with the interface the `workforce` endpoints will have
// (X58, frontend 11 §3–4): open an X45 link, verify by code, report section progress, take the quiz, save tickets
// and sign. The rules that the server owns live here too, so the screens can't decide them: a video counts once
// watched to the end, answers are checked here and never sent to the screen, and the signature is tied to a hash
// of the exact version shown. Data is synthetic.

import { delay, mockId, nowIso, problem } from '@/shared/mocks/runtime';
import type {
  InductionProgress,
  InductionSite,
  OpenInduction,
  OpenedInduction,
  QuizQuestion,
  QuizResult,
  WorkerCredential,
  WorkerDetails,
  WorkerInduction,
} from '../lib/types';
import { isAuMobile, maskMobile } from '../lib/flow';
import type { InductionSource } from './contract';

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
  sectionCount: 7,
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
      title: 'Welcome to Harbour St Tower',
      blocks: [{ type: 'video', fileId: '/preview/induction/welcome.webm', title: null }],
    },
    {
      id: 'sec_emergency',
      title: 'Emergency procedures',
      blocks: [
        {
          type: 'slides',
          slides: [
            {
              title: 'If the alarm sounds',
              points: [
                'Stop work. Make your area safe if you can do it quickly.',
                'Walk, do not run, to the assembly point.',
              ],
            },
            {
              title: 'Assembly point',
              points: [
                'The assembly point is the green A sign inside the Harbour St gate.',
                'Stay there until a warden says you can leave.',
              ],
            },
            {
              title: 'Fire',
              points: [
                'Raise the alarm.',
                'Only use an extinguisher if you are trained and the fire is small.',
                'Call 000 if no one has.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'sec_rules',
      title: 'Site rules',
      blocks: [
        {
          type: 'text',
          body: [
            'These rules keep everyone safe. Breaking them can mean leaving the site.',
            '- Sign in at the gate every day. Sign out when you leave.',
            '- Work hours are 7:00 am to 5:00 pm, Monday to Friday.',
            '- No alcohol or drugs. You may be tested.',
            '- Smoke only in the marked area next to the lunch room.',
            '- Keep walkways clear. Put rubbish in the bins.',
          ].join('\n'),
        },
      ],
    },
    {
      id: 'sec_ppe',
      title: 'PPE and hazards',
      blocks: [
        {
          type: 'text',
          body: [
            '## Always wear',
            '- Hard hat, high-vis shirt or vest, safety boots and safety glasses.',
            '## Main hazards on this site',
            '- Crane lifts: never walk under a load. Keep out of the crane zone when the bell rings.',
            '- Working at heights: use the handrails and harness points. Report missing edge protection.',
            '- Electrical: only licensed electricians touch switchboards and leads.',
          ].join('\n'),
        },
      ],
    },
    {
      id: 'sec_firstaid',
      title: 'First aid, amenities and reporting',
      blocks: [
        {
          type: 'text',
          body: [
            '- First aid is in the site office. The first aiders wear a green hard hat.',
            '- The lunch room and toilets are next to the crane zone fence.',
            '- Report every injury, near miss and hazard to your supervisor the same day.',
          ].join('\n'),
        },
      ],
    },
    {
      id: 'sec_swms',
      title: 'SWMS for this site',
      blocks: [
        {
          type: 'swms',
          documentId: 'doc_swms_heights',
          title: 'SWMS 03 Working at heights',
          summary: [
            'Use edge protection or a harness above 2 metres.',
            'Check your harness before each use.',
            'Never remove edge protection. Tell your supervisor if it is missing.',
          ],
        },
        {
          type: 'swms',
          documentId: 'doc_swms_crane',
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
      title: 'Site map',
      blocks: [
        {
          type: 'image',
          fileId: '/preview/induction/site-map.svg',
          title: 'Site map of Harbour St Tower',
          alt: 'Site map of Harbour St Tower. The gate is on Harbour St, at the bottom of the map. The assembly point, a green A sign, is just inside the gate. The site office and first aid are on the left, the lunch room and toilets on the right. The crane zone is at the top right.',
        },
      ],
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

/** Quiz pass mark: the builder can raise it, never below 70% (IND-AC5). */
export function correctNeeded(total: number, passPercent: number): number {
  return Math.ceil((total * Math.max(70, passPercent)) / 100);
}

function openedFor(s: Session): OpenInduction {
  return {
    state: 'open',
    sessionId: s.id,
    site: SITE,
    induction: INDUCTION,
    companies: COMPANIES,
    progress: s.progress,
  };
}

export const inductionSource: InductionSource = {
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
    return delay(openedFor(s));
  },

  /** Preview files are plain paths under /preview, so the id is already the address. */
  async fileUrl(fileId: string): Promise<string> {
    return fileId;
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
  async verify(sessionId: string, code: string): Promise<OpenInduction> {
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
    return delay(openedFor(s));
  },

  /** A section has been read, watched or opened to the end. The server only records it; the screen decides when. */
  async completeSection(
    sessionId: string,
    sectionId: string,
    _seconds: number,
  ): Promise<InductionProgress> {
    const s = verified(sessionId);
    sectionOf(sectionId);
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
        seeSiteOffice: !passed && s.progress.quiz.attempts >= 3,
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
    };
    return delay(s.progress);
  },
};

export function resetInductionPreview() {
  sessions = new Map();
}
