import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  ACCESS_LINK_SESSION_MS,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type Logger,
  type MessageSender,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import { ESIGN_COOKIE, type Outbound } from '../application/core';
import type { EnvelopeFields, EnvelopeService } from '../application/envelopes';
import type { SigningService } from '../application/signing';
import { toEnvelopeDto } from './mappers';

const LINK_HEADERS = {
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'no-store',
};

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};
const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const envelopeId = (p: { envelopeId: string }) => {
  const id = decodeId('envelope', p.envelopeId);
  if (!id) throw new AppError('esign.not_found');
  return id;
};

interface Body {
  subject?: string;
  message?: string;
  options?: EnvelopeFields['options'];
  documentFileIds?: string[];
  recipients?: EnvelopeFields['recipients'];
  fields?: EnvelopeFields['fields'];
}

/** Request body → service fields, decoding prefixed ids and keeping "absent" distinct from "empty". */
function fields(b: Body): EnvelopeFields {
  const out: EnvelopeFields = {};
  if (b.subject !== undefined) out.subject = b.subject;
  if (b.message !== undefined) out.message = b.message;
  if (b.options !== undefined) out.options = b.options;
  if (b.documentFileIds !== undefined)
    out.documentFileIds = b.documentFileIds.map((f, i) => ref('file', f, `documentFileIds/${i}`));
  if (b.recipients !== undefined)
    out.recipients = b.recipients.map((r, i) => ({
      ...r,
      userId: r.userId ? ref('user', r.userId, `recipients/${i}/userId`) : null,
      companyId: r.companyId ? ref('company', r.companyId, `recipients/${i}/companyId`) : null,
    }));
  if (b.fields !== undefined)
    out.fields = b.fields.map((f) => ({ ...f, documentFileId: f.documentFileId }));
  return out;
}

export interface EsignMail {
  messages: MessageSender;
  logger?: Pick<Logger, 'warn'>;
}

export function esignRoutes(
  database: Database,
  svc: EnvelopeService,
  signing: SigningService,
  mail: EsignMail,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const facts = (input: { ip: string; userAgent: string | null; requestId: string }) => ({
    ip: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  });
  const cookie = (input: { cookies: Readonly<Record<string, string | undefined>> }) =>
    input.cookies[ESIGN_COOKIE];

  /** Sends the emails after the transaction commits; a failed address is logged, never fatal. */
  async function deliver(outbound: readonly Outbound[]) {
    for (const m of outbound)
      try {
        await mail.messages.email(m.to, { subject: m.subject, text: m.text });
      } catch (err) {
        mail.logger?.warn({ err }, 'signing email failed');
      }
  }

  const envelope = (status: number, l: Parameters<typeof toEnvelopeDto>[0]) => ({
    status,
    body: toEnvelopeDto(l),
    headers: { etag: etag(l.env.version) },
  });
  const pdf = (r: { filename: string; bytes: Uint8Array; signed: boolean }) => ({
    status: 200,
    body: {
      filename: r.filename,
      contentType: 'application/pdf' as const,
      dataBase64: Buffer.from(r.bytes).toString('base64'),
      signed: r.signed,
    },
    headers: LINK_HEADERS,
  });

  return defineRoutes({
    listEsignEnvelopes: async (input) => {
      const q = input.query;
      const { page, recips } = await read(input, (s) =>
        svc.list(s, project(input.params), {
          ...(q.sourceType ? { sourceType: q.sourceType } : {}),
          ...(q.sourceId ? { sourceId: q.sourceId } : {}),
          ...(q.status ? { status: q.status } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          data: page.data.map((e) => {
            const mine = recips.filter((r) => r.envelopeId === e.id);
            const signers = mine.filter((r) => r.role === 'needs_to_sign');
            return {
              id: encodeId('envelope', e.id),
              subject: e.subject,
              status: e.status,
              sourceType: e.sourceType,
              sourceId: e.sourceId,
              recipientCount: mine.length,
              signedCount: signers.filter((r) => r.status === 'signed').length,
              sentAt: e.sentAt?.toISOString() ?? null,
              expiresAt: e.expiresAt?.toISOString() ?? null,
              completedAt: e.completedAt?.toISOString() ?? null,
              createdAt: e.createdAt.toISOString(),
            };
          }),
          nextCursor: page.nextCursor,
        },
      };
    },
    createEsignEnvelope: async (input) =>
      envelope(
        201,
        await tx(input, (s) =>
          svc.create(s, project(input.params), {
            ...fields(input.body),
            ...(input.body.sourceType ? { sourceType: input.body.sourceType } : {}),
            ...(input.body.sourceId ? { sourceId: input.body.sourceId } : {}),
          }),
        ),
      ),
    getEsignEnvelope: async (input) =>
      envelope(
        200,
        await tx(input, (s) => svc.get(s, project(input.params), envelopeId(input.params))),
      ),
    updateEsignEnvelope: async (input) =>
      envelope(
        200,
        await tx(input, (s) =>
          svc.update(
            s,
            project(input.params),
            envelopeId(input.params),
            parseIfMatch(input.headers['if-match']),
            fields(input.body),
          ),
        ),
      ),
    deleteEsignEnvelope: async (input) => {
      await tx(input, (s) => svc.remove(s, project(input.params), envelopeId(input.params)));
      return { status: 204 };
    },
    sendEsignEnvelope: async (input) => {
      const r = await tx(input, (s) =>
        svc.send(
          s,
          project(input.params),
          envelopeId(input.params),
          parseIfMatch(input.headers['if-match']),
        ),
      );
      await deliver(r.mail);
      return envelope(200, r.loaded);
    },
    voidEsignEnvelope: async (input) =>
      envelope(
        200,
        await tx(input, (s) =>
          svc.void(s, project(input.params), envelopeId(input.params), input.body.reason),
        ),
      ),
    remindEsignEnvelope: async (input) => {
      const r = await tx(input, (s) =>
        svc.remind(s, project(input.params), envelopeId(input.params)),
      );
      await deliver(r.mail);
      return envelope(200, r.loaded);
    },
    confirmEsignPaperSigned: async (input) => {
      const r = await tx(input, (s) =>
        svc.confirmPaper(
          s,
          project(input.params),
          envelopeId(input.params),
          ref('envelopeRecipient', input.params.recipientId, 'recipientId'),
        ),
      );
      await deliver(r.mail);
      return envelope(200, r.loaded);
    },
    getEsignDocumentPdf: async (input) =>
      pdf(
        await tx(input, (s) =>
          svc.pdf(
            s,
            project(input.params),
            envelopeId(input.params),
            ref('envelopeDocument', input.params.documentId, 'documentId'),
          ),
        ),
      ),

    // ------------------------------------------------------------------- the recipient's side (no account)
    openEsignAccess: async (input) => {
      const r = await signing.open(input.body.token, facts(input));
      await deliver(r.mail);
      return {
        status: 200,
        body: r.body,
        headers: LINK_HEADERS,
        setCookies: [
          {
            name: ESIGN_COOKIE,
            value: r.cookie,
            httpOnly: true,
            maxAgeSeconds: Math.floor(ACCESS_LINK_SESSION_MS / 1000),
          },
        ],
      };
    },
    getEsignAccess: async (input) => ({
      status: 200,
      body: await signing.view(cookie(input), facts(input)),
      headers: LINK_HEADERS,
    }),
    signEsignAccess: async (input) => {
      if (input.body.consent !== true)
        throw new AppError('validation_failed', 'Agree to sign electronically to continue.', [
          { path: 'consent', message: 'Required' },
        ]);
      const r = await signing.sign(
        cookie(input),
        { signatureKind: input.body.signatureKind, signature: input.body.signature },
        facts(input),
      );
      await deliver(r.mail);
      return { status: 200, body: r.body, headers: LINK_HEADERS };
    },
    declineEsignAccess: async (input) => {
      const r = await signing.decline(cookie(input), input.body.reason, facts(input));
      return { status: 200, body: r.body, headers: LINK_HEADERS };
    },
    delegateEsignAccess: async (input) => {
      const r = await signing.delegate(cookie(input), input.body, facts(input));
      await deliver(r.mail);
      return { status: 200, body: r.body, headers: LINK_HEADERS };
    },
    getEsignAccessDocumentPdf: async (input) =>
      pdf(
        await signing.documentPdf(
          cookie(input),
          ref('envelopeDocument', input.params.documentId, 'documentId'),
          facts(input),
        ),
      ),
  });
}
