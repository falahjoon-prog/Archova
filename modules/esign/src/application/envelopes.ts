// The sender's side: build a draft, send it, remind, void, confirm a paper signature and download the PDFs.
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { decodeId, uuidv7, type IdKind } from '@archova/domain';
import { AppError, decodeCursor, toPage, versionConflict, type TenantScope } from '@archova/kernel';
import {
  DEFAULT_EXPIRES_DAYS,
  MAX_DOCUMENTS,
  MAX_RECIPIENTS,
  expiryOf,
  isTurn,
  oneLine,
  sendProblems,
  toNotify,
  type EnvelopeStatus,
  type FieldKind,
  type RecipientRole,
  type SourceType,
} from '../domain/envelope';
import { documents, envelopes, fields, recipients } from '../infra/tables';
import {
  MAX_PDF_BYTES,
  stateOf,
  type EsignDeps,
  type Loaded,
  type Outbound,
  createEsignCore,
} from './core';

export interface RecipientInput {
  name: string;
  email: string;
  role?: RecipientRole;
  routingOrder?: number;
  customSubject?: string | null;
  customMessage?: string | null;
  language?: 'en';
  userId?: string | null;
  companyId?: string | null;
}

export interface FieldInput {
  documentFileId: string;
  recipientEmail: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EnvelopeOptions {
  signingOrder?: boolean;
  allowPaper?: boolean;
  allowDelegate?: boolean;
  expiresDays?: number;
  reminderDays?: number | null;
}

export interface EnvelopeFields {
  subject?: string;
  message?: string;
  options?: EnvelopeOptions;
  documentFileIds?: string[];
  recipients?: RecipientInput[];
  fields?: FieldInput[];
}

/** `sourceId` arrives as a public id for the record's kind; the table keeps the bare uuid. */
const SOURCE_KINDS: Record<SourceType, IdKind | null> = {
  correspondence: 'correspondence',
  rfi: 'rfi',
  submittal: 'submittal',
  contract: 'contract',
  other: null,
};

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', 'Check the highlighted fields.', [{ path, message }]);

export function createEnvelopeService(deps: EsignDeps) {
  const core = createEsignCore(deps);
  const now = core.now;

  function sourceOf(type: SourceType | undefined, id: string | undefined) {
    if (!type && !id) return { sourceType: null, sourceId: null };
    if (!type || !id) throw invalid('sourceId', 'Give both the record type and its id');
    const kind = SOURCE_KINDS[type];
    const uuid = kind ? decodeId(kind, id) : /^[0-9a-f-]{36}$/i.test(id) ? id : null;
    if (!uuid) throw invalid('sourceId', 'Invalid id');
    return { sourceType: type, sourceId: uuid };
  }

  /** Each file must be a ready PDF on this project; returns its row so the document keeps the file's name. */
  async function checkFiles(scope: TenantScope, projectId: string, fileIds: readonly string[]) {
    if (fileIds.length > MAX_DOCUMENTS)
      throw invalid('documentFileIds', `At most ${MAX_DOCUMENTS} documents per envelope`);
    if (new Set(fileIds).size !== fileIds.length)
      throw invalid('documentFileIds', 'Each document can only be added once');
    const rows = [];
    for (const [i, id] of fileIds.entries()) {
      const f = await deps.files.getFile(scope, id);
      if (f.projectId !== projectId)
        throw invalid(`documentFileIds/${i}`, 'That file is not on this project');
      if (f.mime !== 'application/pdf')
        throw new AppError('esign.not_a_pdf', 'Only PDF documents can be sent for signature.', [
          { path: `documentFileIds/${i}`, message: 'Not a PDF' },
        ]);
      if (f.status !== 'ready')
        throw new AppError('file.not_ready', 'Wait for the file to finish uploading and scanning.');
      rows.push(f);
    }
    return rows;
  }

  function recipientRows(scope: TenantScope, envelopeId: string, input: readonly RecipientInput[]) {
    if (input.length > MAX_RECIPIENTS)
      throw invalid('recipients', `At most ${MAX_RECIPIENTS} recipients per envelope`);
    return input.map((r, i) => ({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      envelopeId,
      name: oneLine(r.name),
      email: r.email.trim(),
      role: r.role ?? ('needs_to_sign' as const),
      routingOrder: r.routingOrder ?? i + 1,
      customSubject: r.customSubject ? oneLine(r.customSubject) : null,
      customMessage: r.customMessage?.trim() || null,
      language: r.language ?? 'en',
      userId: r.userId ?? null,
      companyId: r.companyId ?? null,
    }));
  }

  async function writeLists(
    scope: TenantScope,
    l: Loaded,
    input: EnvelopeFields,
    projectId: string,
  ) {
    const envelopeId = l.env.id;
    let docs = l.docs;
    if (input.documentFileIds) {
      const files = await checkFiles(scope, projectId, input.documentFileIds);
      await scope.tx.delete(fields).where(eq(fields.envelopeId, envelopeId));
      await scope.tx.delete(documents).where(eq(documents.envelopeId, envelopeId));
      docs = files.map((f, position) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        envelopeId,
        fileId: f.id,
        name: f.filename,
        position,
        sha256: null,
        signedSha256: null,
      }));
      if (docs.length) await scope.tx.insert(documents).values(docs);
    }
    let recips = l.recips;
    if (input.recipients) {
      await scope.tx.delete(fields).where(eq(fields.envelopeId, envelopeId));
      await scope.tx.delete(recipients).where(eq(recipients.envelopeId, envelopeId));
      const rows = recipientRows(scope, envelopeId, input.recipients);
      if (rows.length) await scope.tx.insert(recipients).values(rows);
      recips = rows.map((r) => ({
        ...r,
        status: 'pending' as const,
        accessLinkId: null,
        copyLinkId: null,
        sentAt: null,
        viewedAt: null,
        completedAt: null,
        signedOnPaper: false,
        signatureKind: null,
        signatureValue: null,
        signerIp: null,
        signerUserAgent: null,
        declineReason: null,
        delegatedFrom: null,
      }));
    }
    // Placed fields are rewritten with whichever side changed, so they always point at live documents and people.
    const fieldInput = input.fields ?? (input.documentFileIds || input.recipients ? [] : null);
    if (fieldInput) {
      await scope.tx.delete(fields).where(eq(fields.envelopeId, envelopeId));
      const rows = fieldInput.map((f, i) => {
        const doc = docs.find((d) => d.fileId === decodeFile(f.documentFileId, i));
        const rec = recips.find((r) => r.email.toLowerCase() === f.recipientEmail.toLowerCase());
        if (!doc) throw invalid(`fields/${i}/documentFileId`, 'Not one of the envelope documents');
        if (!rec || rec.role !== 'needs_to_sign')
          throw invalid(`fields/${i}/recipientEmail`, 'Not a recipient who needs to sign');
        return {
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          envelopeId,
          documentId: doc.id,
          recipientId: rec.id,
          kind: f.kind,
          page: f.page,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
        };
      });
      if (rows.length) await scope.tx.insert(fields).values(rows);
    }
  }

  function decodeFile(id: string, i: number) {
    const uuid = decodeId('file', id);
    if (!uuid) throw invalid(`fields/${i}/documentFileId`, 'Invalid id');
    return uuid;
  }

  function optionColumns(o: EnvelopeOptions | undefined) {
    return {
      ...(o?.signingOrder !== undefined ? { signingOrder: o.signingOrder } : {}),
      ...(o?.allowPaper !== undefined ? { allowPaper: o.allowPaper } : {}),
      ...(o?.allowDelegate !== undefined ? { allowDelegate: o.allowDelegate } : {}),
      ...(o?.expiresDays !== undefined ? { expiresDays: o.expiresDays } : {}),
      ...(o?.reminderDays !== undefined ? { reminderDays: o.reminderDays } : {}),
    };
  }

  // ------------------------------------------------------------------------------------------ reads

  async function list(
    scope: TenantScope,
    projectId: string,
    q: {
      sourceType?: SourceType;
      sourceId?: string;
      status?: EnvelopeStatus;
      limit: number;
      cursor?: string;
    },
  ) {
    const conds: SQL[] = [eq(envelopes.projectId, projectId), isNull(envelopes.deletedAt)];
    if (q.sourceType) conds.push(eq(envelopes.sourceType, q.sourceType));
    if (q.sourceId) {
      const { sourceId } = sourceOf(q.sourceType, q.sourceId);
      conds.push(eq(envelopes.sourceId, sourceId!));
    }
    if (q.status) conds.push(eq(envelopes.status, q.status));
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor);
    if (cur)
      conds.push(
        sql`(${envelopes.createdAt}, ${envelopes.id}) < (${new Date(cur.t).toISOString()}::timestamptz, ${cur.id}::uuid)`,
      );
    const rows = await scope.tx
      .select()
      .from(envelopes)
      .where(and(...conds))
      .orderBy(desc(envelopes.createdAt), desc(envelopes.id))
      .limit(q.limit + 1);
    const ids = rows.map((r) => r.id);
    const recips = ids.length
      ? await scope.tx.select().from(recipients).where(inArray(recipients.envelopeId, ids))
      : [];
    const page = toPage(rows, q.limit, (r) => ({ t: r.createdAt.toISOString(), id: r.id }));
    return {
      page,
      recips: recips.filter((r) => r.status !== 'delegated'),
    };
  }

  async function get(scope: TenantScope, projectId: string, envelopeId: string) {
    return core.expireIfDue(scope, await core.load(scope, envelopeId, projectId));
  }

  // ----------------------------------------------------------------------------------------- writes

  async function create(
    scope: TenantScope,
    projectId: string,
    input: EnvelopeFields & { sourceType?: SourceType; sourceId?: string },
  ) {
    const src = sourceOf(input.sourceType, input.sourceId);
    const id = uuidv7();
    const t = now();
    await scope.tx.insert(envelopes).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      ...src,
      subject: oneLine(input.subject ?? ''),
      message: (input.message ?? '').trim(),
      status: 'draft',
      expiresDays: DEFAULT_EXPIRES_DAYS,
      ...optionColumns(input.options),
      createdAt: t,
      updatedAt: t,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    const blank = await core.load(scope, id);
    await writeLists(scope, blank, input, projectId);
    await core.record(scope, id, 'created', { actorUserId: scope.ctx.userId });
    return core.load(scope, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    envelopeId: string,
    expectedVersion: number,
    input: EnvelopeFields,
  ) {
    const l = await core.load(scope, envelopeId, projectId);
    if (l.env.status !== 'draft')
      throw new AppError('esign.invalid_state', 'Only a draft can be changed.');
    if (l.env.version !== expectedVersion) throw versionConflict();
    const t = now();
    const [row] = await scope.tx
      .update(envelopes)
      .set({
        ...(input.subject !== undefined ? { subject: oneLine(input.subject) } : {}),
        ...(input.message !== undefined ? { message: input.message.trim() } : {}),
        ...optionColumns(input.options),
        version: l.env.version + 1,
        updatedAt: t,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(envelopes.id, envelopeId), eq(envelopes.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await writeLists(scope, l, input, projectId);
    return core.load(scope, envelopeId);
  }

  async function remove(scope: TenantScope, projectId: string, envelopeId: string) {
    const l = await core.load(scope, envelopeId, projectId);
    if (l.env.status !== 'draft')
      throw new AppError('esign.invalid_state', 'A sent envelope is voided, not deleted.');
    await scope.tx
      .update(envelopes)
      .set({ deletedAt: now(), version: l.env.version + 1 })
      .where(eq(envelopes.id, envelopeId));
  }

  /** Checks every document parses as a PDF and every placed field points at a real page. */
  async function checkPdfs(scope: TenantScope, l: Loaded) {
    const sha: Array<{ id: string; sha256: string }> = [];
    for (const d of l.docs) {
      const { file, bytes } = await deps.files.readFileBytes(scope, d.fileId, MAX_PDF_BYTES);
      let pages: number;
      try {
        pages = (await PDFDocument.load(bytes)).getPageCount();
      } catch {
        throw new AppError(
          'esign.not_a_pdf',
          `"${d.name}" can't be read as a PDF (it may be password protected).`,
        );
      }
      if (l.fields.some((f) => f.documentId === d.id && f.page > pages))
        throw invalid('fields', `A signature field is on a page "${d.name}" doesn't have`);
      sha.push({
        id: d.id,
        sha256: file.sha256 || createHash('sha256').update(bytes).digest('hex'),
      });
    }
    return sha;
  }

  async function send(
    scope: TenantScope,
    projectId: string,
    envelopeId: string,
    expectedVersion: number,
  ): Promise<{ loaded: Loaded; mail: Outbound[] }> {
    const l = await core.load(scope, envelopeId, projectId);
    if (l.env.status !== 'draft')
      throw new AppError('esign.invalid_state', 'This envelope has already been sent.');
    if (l.env.version !== expectedVersion) throw versionConflict();
    const problems = sendProblems({
      subject: l.env.subject,
      documentCount: l.docs.length,
      recipients: l.recips,
    });
    if (problems.length)
      throw new AppError('esign.incomplete', 'Finish the envelope before sending it.', problems);
    for (const d of await checkPdfs(scope, l))
      await scope.tx.update(documents).set({ sha256: d.sha256 }).where(eq(documents.id, d.id));
    const t = now();
    const expiresAt = expiryOf(t, l.env.expiresDays);
    const [row] = await scope.tx
      .update(envelopes)
      .set({
        status: 'sent',
        sentAt: t,
        sentBy: scope.ctx.userId,
        expiresAt,
        version: l.env.version + 1,
        updatedAt: t,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(envelopes.id, envelopeId), eq(envelopes.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    const sent = await core.load(scope, envelopeId);
    const due = toNotify(sent.recips.map(stateOf), sent.env.signingOrder);
    const mail = await core.issueLinks(
      scope,
      sent,
      sent.recips.filter((r) => due.some((x) => x.id === r.id)),
      'invite',
    );
    scope.events.add({
      type: 'esign.envelope.sent.v1',
      projectId,
      entityType: 'esign_envelope',
      entityId: envelopeId,
      data: { envelopeId, sourceType: row.sourceType, sourceId: row.sourceId },
    });
    return { loaded: await core.load(scope, envelopeId), mail };
  }

  async function voidEnvelope(
    scope: TenantScope,
    projectId: string,
    envelopeId: string,
    reason: string,
  ) {
    const l = await core.load(scope, envelopeId, projectId);
    if (l.env.status !== 'sent')
      throw new AppError('esign.invalid_state', 'Only a sent envelope can be voided.');
    const t = now();
    await scope.tx
      .update(envelopes)
      .set({
        status: 'voided',
        voidedAt: t,
        voidReason: reason.trim(),
        version: l.env.version + 1,
        updatedAt: t,
        updatedBy: scope.ctx.userId,
      })
      .where(eq(envelopes.id, envelopeId));
    await core.revokeAll(scope, l.recips);
    await core.record(scope, envelopeId, 'voided', {
      actorUserId: scope.ctx.userId,
      data: { reason: reason.trim() },
    });
    scope.events.add({
      type: 'esign.envelope.voided.v1',
      projectId,
      entityType: 'esign_envelope',
      entityId: envelopeId,
      data: { envelopeId },
    });
    return core.load(scope, envelopeId);
  }

  /** Emails everyone whose turn it is and who hasn't acted, with a fresh link each. At most hourly per person. */
  async function remind(scope: TenantScope, projectId: string, envelopeId: string) {
    const l = await core.expireIfDue(scope, await core.load(scope, envelopeId, projectId));
    if (l.env.status !== 'sent')
      throw new AppError('esign.invalid_state', 'Only a sent envelope can be reminded.');
    const waiting = l.recips.filter(
      (r) =>
        (r.status === 'sent' || r.status === 'viewed') &&
        isTurn(l.recips.map(stateOf), l.env.signingOrder, r.id),
    );
    const recent = await core.recentlyMailed(
      scope,
      waiting.map((r) => r.id),
    );
    const due = waiting.filter((r) => !recent.has(r.id));
    if (waiting.length && !due.length)
      throw new AppError(
        'esign.rate_limited',
        'Everyone was emailed within the last hour. Try again later.',
      );
    const mail = await core.issueLinks(scope, l, due, 'reminder');
    return { loaded: await core.load(scope, envelopeId), mail };
  }

  /** The sender confirms a recipient signed on paper (only if the envelope allows it). */
  async function confirmPaper(
    scope: TenantScope,
    projectId: string,
    envelopeId: string,
    recipientId: string,
  ) {
    const l = await core.expireIfDue(scope, await core.load(scope, envelopeId, projectId));
    if (l.env.status !== 'sent')
      throw new AppError('esign.invalid_state', 'This envelope is not waiting for signatures.');
    if (!l.env.allowPaper)
      throw new AppError(
        'esign.paper_not_allowed',
        'This envelope does not allow signing on paper.',
      );
    const r = l.recips.find((x) => x.id === recipientId);
    if (!r) throw new AppError('esign.recipient_not_found');
    if (r.role !== 'needs_to_sign' || !['pending', 'sent', 'viewed'].includes(r.status))
      throw new AppError('esign.invalid_state', 'That recipient is not waiting to sign.');
    if (!isTurn(l.recips.map(stateOf), l.env.signingOrder, r.id))
      throw new AppError('esign.not_your_turn', 'Earlier signers have not finished yet.');
    const t = now();
    await scope.tx
      .update(recipients)
      .set({ status: 'signed', signedOnPaper: true, completedAt: t })
      .where(eq(recipients.id, r.id));
    if (r.accessLinkId) await core.revokeAll(scope, [r]);
    await core.record(scope, envelopeId, 'signed_on_paper', {
      recipientId: r.id,
      actorUserId: scope.ctx.userId,
    });
    const mail = await core.advance(scope, envelopeId, scope.ctx.userId);
    return { loaded: await core.load(scope, envelopeId), mail };
  }

  /** The PDF a sender downloads: the signed copy once complete, otherwise the original. */
  async function pdf(
    scope: TenantScope,
    projectId: string,
    envelopeId: string,
    documentId: string,
  ) {
    const l = await core.load(scope, envelopeId, projectId);
    const doc = l.docs.find((d) => d.id === documentId);
    if (!doc) throw new AppError('esign.document_not_found');
    return documentPdf(scope, l, doc);
  }

  async function documentPdf(scope: TenantScope, l: Loaded, doc: Loaded['docs'][number]) {
    const base = doc.name.replace(/\.pdf$/i, '');
    if (l.env.status === 'completed') {
      const n = await core.names(scope, l.env);
      const bytes = await core.renderDocument(scope, l, doc, n.timezone);
      if (doc.signedSha256 && createHash('sha256').update(bytes).digest('hex') !== doc.signedSha256)
        deps.logger?.error({ envelopeId: l.env.id, documentId: doc.id }, 'signed pdf hash changed');
      return { filename: `${base} (signed).pdf`, bytes, signed: true };
    }
    const { bytes } = await deps.files.readFileBytes(scope, doc.fileId, MAX_PDF_BYTES, {
      authorised: true,
    });
    return { filename: `${base}.pdf`, bytes, signed: false };
  }

  return {
    list,
    get,
    create,
    update,
    remove,
    send,
    void: voidEnvelope,
    remind,
    confirmPaper,
    pdf,
    documentPdf,
    core,
  };
}

export type EnvelopeService = ReturnType<typeof createEnvelopeService>;
