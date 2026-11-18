// The worker's induction flow against the workforce module's access-link endpoints (Ben's #37 and #38, X45).
// The link token is exchanged once (`POST /v1/induction-access`) for the `__Host-lnk` cookie, which the browser
// then sends on every call, so no call below carries the token or a session id. Content (sections, quiz,
// declaration) is released only after the mobile is verified, so before that the induction has a section count
// and nothing else. The server records what a worker has seen and scores the quiz; the screens decide when a
// section has been seen to the end.

import { ApiError, unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { isAuMobile } from '../lib/flow';
import type {
  CredentialType,
  InductionProgress,
  InductionSection,
  InductionSite,
  OpenInduction,
  QuizQuestion,
  QuizResult,
  SectionBlock,
  WorkerCredential,
  WorkerDetails,
} from '../lib/types';
import type { InductionSource } from './contract';

type S = components['schemas'];
type Access = S['InductionAccess'];
type Completion = S['InductionCompletion'];
type WorkerContent = S['InductionWorkerContent'];

const KIND_OF: Record<CredentialType, S['WorkerCredentialKind']> = {
  white_card: 'white_card',
  hrwl: 'high_risk_licence',
  trade_licence: 'trade_licence',
};
const TYPE_OF: Record<S['WorkerCredentialKind'], CredentialType> = {
  white_card: 'white_card',
  high_risk_licence: 'hrwl',
  trade_licence: 'trade_licence',
  other: 'trade_licence',
};
const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'];

function problem(status: number, code: string, detail: string): ApiError {
  return new ApiError(status, {
    type: 'about:blank',
    title: detail,
    status,
    detail,
    code,
  } as never);
}

const sectionId = (index: number) => `sec_${index}`;

/** +61412345678 from 0412 345 678 or +61 412 345 678. */
export function toE164(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits.startsWith('61') ? `+${digits}` : `+61${digits.replace(/^0/, '')}`;
}

/** The finger strokes as one SVG path in a 300 x 100 box (the pad is 3:1), which the server stores with the record. */
export function strokesToPath(strokes: Array<Array<{ x: number; y: number }>>): string {
  const n = (v: number) => Math.round(v * 10) / 10;
  return strokes
    .filter((s) => s.length > 0)
    .map(
      (s) =>
        `M${n(s[0]!.x * 300)} ${n(s[0]!.y * 100)}` +
        s
          .slice(1)
          .map((p) => `L${n(p.x * 300)} ${n(p.y * 100)}`)
          .join(''),
    )
    .join('');
}

function blockOf(b: S['InductionBlock']): SectionBlock {
  switch (b.type) {
    case 'slides':
      return { type: 'slides', slides: b.slides.map(({ title, points }) => ({ title, points })) };
    case 'text':
      return { type: 'text', body: b.body };
    case 'animation':
      return { type: 'animation', title: b.title ?? null, scenes: b.scenes };
    case 'swms':
      return {
        type: 'swms',
        documentId: b.documentId,
        title: b.title ?? 'Safe work method statement',
      };
    case 'video':
      return { type: 'video', fileId: b.fileId, title: b.title ?? null };
    case 'document':
      return { type: 'document', fileId: b.fileId, title: b.title ?? null };
    case 'image':
      return { type: 'image', fileId: b.fileId, title: b.title ?? null };
  }
}

export const sectionsOf = (content: WorkerContent): InductionSection[] =>
  content.sections.map((s, i) => ({
    id: sectionId(i),
    title: s.title,
    blocks: s.blocks.map(blockOf),
  }));

function credentialOf(c: S['WorkerCredential']): WorkerCredential {
  const type = TYPE_OF[c.kind];
  return {
    id: c.id,
    type,
    label: type === 'white_card' ? 'White card' : (c.licenceClass ?? 'Licence'),
    number: c.number,
    state: c.issuingState,
    expiry: c.expiresOn,
    status: c.status,
    hasPhoto: c.fileIds.length > 0,
  };
}

/** The statements ticked on B6: one per line of the fixed declaration text. */
const statementsOf = (text: string) =>
  text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

export function createInductionAccessApi(): InductionSource {
  let content: WorkerContent | null = null;
  let details: WorkerDetails | null = null;

  const siteOf = (a: Access): InductionSite => ({
    builderName: a.orgName,
    siteName: a.siteName ?? a.projectName,
    siteAddress: null,
    officePhone: null,
    // The worker is on site, so their phone's zone is the site's.
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  function progressOf(a: Access, c: Completion | null): InductionProgress {
    const viewed = new Set(c?.sectionsViewed ?? []);
    return {
      verified: a.verified,
      worker: a.worker
        ? {
            name: a.worker.fullName,
            companyName: a.worker.companyName ?? '',
            mobileMasked: a.verifiedTo ?? '',
          }
        : null,
      returning: a.worker?.returning ?? false,
      sections: Object.fromEntries(
        (content?.sections ?? []).map((_, i) => [sectionId(i), { complete: viewed.has(i) }]),
      ),
      quiz: { passed: c?.quiz.passed ?? false, attempts: c?.quiz.attempts ?? 0 },
      credentials: (c?.credentials ?? []).map(credentialOf),
      completion:
        c?.status === 'completed' && c.completedAt
          ? { completedAt: c.completedAt, version: c.versionNumber }
          : null,
    };
  }

  function openedOf(a: Access, c: Completion | null): OpenInduction {
    if (c) content = c.content;
    return {
      state: 'open',
      sessionId: '',
      site: siteOf(a),
      induction: {
        id: a.completionId ?? '',
        name: a.inductionTitle,
        version: a.versionNumber,
        publishedAt: a.publishedAt,
        estimatedMinutes: null,
        sectionCount: a.sectionCount,
        sections: content ? sectionsOf(content) : [],
        quiz: { questionCount: content?.quiz.length ?? 0, passPercent: content?.passMark ?? 80 },
        requiredLicences: [],
        declaration: content ? statementsOf(content.declarationText) : [],
      },
      companies: a.companies,
      progress: progressOf(a, c),
    };
  }

  const getCompletion = async () => unwrap(await api.GET('/v1/induction-access/completion'));
  const getAccess = async () => unwrap(await api.GET('/v1/induction-access'));

  /** Reads the worker's induction again after a write, so what the screen shows is what the server holds. */
  async function reload(): Promise<{ access: Access; completion: Completion }> {
    const [access, completion] = await Promise.all([getAccess(), getCompletion()]);
    content = completion.content;
    return { access, completion };
  }
  async function progress(): Promise<InductionProgress> {
    const { access, completion } = await reload();
    return progressOf(access, completion);
  }

  const dead = (e: unknown) =>
    e instanceof ApiError && (e.status === 401 || e.code === 'access_link.invalid');

  return {
    async open(token) {
      content = null;
      let access: Access;
      try {
        access =
          token === 'continue'
            ? await getAccess()
            : unwrap(await api.POST('/v1/induction-access', { body: { token } }));
      } catch (e) {
        // An expired, revoked or unknown link all look the same, by design; so does one that isn't shaped like a token.
        if (dead(e) || (e instanceof ApiError && e.status === 422))
          return { state: 'expired', site: null };
        throw e;
      }
      return openedOf(access, access.verified ? await getCompletion() : null);
    },

    async sendCode(_sid, d, channel) {
      if (!d.name.trim()) throw problem(422, 'validation_failed', 'Enter your full name.');
      if (!d.companyName.trim())
        throw problem(422, 'validation_failed', 'Choose or type your company.');
      if (channel.kind === 'sms' && !isAuMobile(d.mobile))
        throw problem(
          422,
          'validation_failed',
          'Enter an Australian mobile number, like 0412 345 678.',
        );
      if (channel.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(channel.email))
        throw problem(422, 'validation_failed', 'Enter an email address, like sam@example.com.');
      details = d;
      const sent = unwrap(
        await api.POST('/v1/induction-access/codes', {
          body:
            channel.kind === 'sms'
              ? { channel: 'sms', to: toE164(d.mobile) }
              : { channel: 'email', to: channel.email.trim() },
        }),
      );
      return { sentTo: sent.to };
    },

    async verify(_sid, code) {
      if (!details)
        throw problem(409, 'induction.no_code', 'Enter your details and send a code first.');
      const access = unwrap(
        await api.POST('/v1/induction-access/verify', {
          body: {
            code: code.trim(),
            fullName: details.name.trim(),
            ...(details.companyId
              ? { companyId: details.companyId }
              : { companyName: details.companyName.trim() }),
          },
        }),
      );
      return openedOf(access, await getCompletion());
    },

    async completeSection(_sid, id, seconds) {
      const index = content?.sections.findIndex((_, i) => sectionId(i) === id) ?? -1;
      if (index < 0) throw problem(404, 'not_found', "We couldn't find that section.");
      unwrap(
        await api.POST('/v1/induction-access/progress', {
          body: { section: index, seconds: Math.min(86_400, Math.max(0, Math.round(seconds))) },
        }),
      );
      return progress();
    },

    async quizQuestions() {
      content ??= (await getCompletion()).content;
      return content.quiz.map((q): QuizQuestion => ({
        id: q.id,
        text: q.question,
        options: q.options.map((text, i) => ({ id: String(i), text })),
      }));
    },

    async submitQuiz(_sid, answers) {
      const res = unwrap(
        await api.POST('/v1/induction-access/quiz-attempts', {
          body: {
            answers: Object.entries(answers).map(([questionId, option]) => ({
              questionId,
              answerIndex: Number(option),
            })),
          },
        }),
      );
      const next = await progress();
      const total = content?.quiz.length ?? 0;
      const result: QuizResult = {
        passed: res.passed,
        correct: Math.round((res.score * total) / 100),
        total,
        needed: Math.ceil((total * (content?.passMark ?? 80)) / 100),
        missedCritical: res.criticalMissed,
        reviewSectionIds: res.reviewSections.map(sectionId),
        attempt: res.attempt,
        seeSiteOffice: res.seeSiteOffice,
      };
      return { result, progress: next };
    },

    async saveCredential(_sid, input) {
      if (!input.number.trim())
        throw problem(422, 'validation_failed', 'Enter the number on the card.');
      if (input.type === 'white_card' && !input.state)
        throw problem(422, 'validation_failed', 'Choose the state that issued your white card.');
      if (input.type !== 'white_card' && !input.expiry)
        throw problem(422, 'validation_failed', 'Enter the expiry date on the licence.');
      if (!input.photo)
        throw problem(422, 'validation_failed', 'Take or choose a photo of the card to save it.');
      const fileId = await uploadPhoto(input.photo);
      const body: S['CreateWorkerCredentialRequest'] = {
        kind: KIND_OF[input.type],
        number: input.number.trim(),
        fileIds: [fileId],
        ...(input.state ? { issuingState: input.state as S['AuState'] } : {}),
        ...(input.type !== 'white_card' ? { licenceClass: input.label } : {}),
        ...(input.expiry ? { expiresOn: input.expiry } : {}),
      };
      // The photo is scanned for malware before it can be attached, which takes a few seconds.
      for (let attempt = 0; ; attempt++) {
        try {
          unwrap(await api.POST('/v1/induction-access/credentials', { body }));
          break;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 422) || attempt >= 7) throw e;
          await new Promise((r) => setTimeout(r, 1000 * Math.min(attempt + 1, 4)));
        }
      }
      return progress();
    },

    async sign(_sid, input) {
      const data =
        // A typed signature has no strokes: the typed name is the signature and travels in `typedName`.
        input.signature.method === 'drawn' ? strokesToPath(input.signature.strokes) : 'M0 0';
      unwrap(
        await api.POST('/v1/induction-access/sign', {
          body: {
            typedName: input.name.trim(),
            signature: { format: 'svg', data: data || 'M0 0' },
            fitForWork: input.statementsAccepted > 0,
            agreed: input.statementsAccepted > 0,
            clientAt: input.deviceTime,
          },
        }),
      );
      return progress();
    },

    async fileUrl(fileId) {
      const link = unwrap(
        await api.GET('/v1/induction-access/files/{fileId}/download', {
          params: { path: { fileId } },
        }),
      );
      return link.url;
    },
  };
}

/** Start, PUT to storage on the presigned address, complete. Returns the file id to attach to the ticket. */
async function uploadPhoto(photo: Blob): Promise<string> {
  const mime = PHOTO_MIMES.includes(photo.type) ? photo.type : 'image/jpeg';
  const digest = await crypto.subtle.digest('SHA-256', await photo.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  const upload = unwrap(
    await api.POST('/v1/induction-access/uploads', {
      body: {
        filename: `card.${mime === 'application/pdf' ? 'pdf' : mime.split('/')[1]}`,
        mime: mime as S['CreateLinkUploadRequest']['mime'],
        sizeBytes: photo.size,
        sha256,
      },
    }),
  );
  const put = await fetch(upload.uploadUrl, {
    method: upload.uploadMethod,
    headers: upload.uploadHeaders,
    body: photo,
  });
  if (!put.ok) throw new ApiError(put.status, null);
  const stored = unwrap(
    await api.POST('/v1/induction-access/uploads/{uploadId}/complete', {
      params: { path: { uploadId: upload.id } },
    }),
  );
  return stored.id;
}
