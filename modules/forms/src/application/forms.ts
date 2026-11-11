import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { uuidv7, decodeId, encodeId } from '@archova/domain';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf } from '@archova/time';
import {
  cleanAnswers,
  fieldListProblems,
  missingForSubmit,
  type Answers,
  type FormCategory,
  type FormField,
  type LinkModule,
} from '../domain/fields';
import {
  addDays,
  isOverdue,
  normaliseName,
  signersNotOnSite,
  type AttendanceRow,
} from '../domain/flags';
import { LIBRARY, findLibrary, libraryId, type LibraryTemplate } from '../domain/library';
import { forms, signatures, templates } from '../infra/tables';

export type TemplateRow = typeof templates.$inferSelect;
export type FormRow = typeof forms.$inferSelect;
export type SignatureRow = typeof signatures.$inferSelect;

export interface FormsDeps {
  platform: Pick<PlatformApi, 'getProject'>;
  identity: Pick<IdentityApi, 'getUsers'>;
  /** From `workforce`: site sign-ins in a date range, by worker name. */
  attendance: (
    scope: TenantScope,
    projectId: string,
    range: { from: string; to: string },
  ) => Promise<AttendanceRow[]>;
  now?: () => Date;
}

/** A template as the screens see it: built-in or the organisation's own. */
export interface TemplateView {
  id: string;
  source: 'library' | 'custom';
  name: string;
  description: string;
  category: FormCategory;
  fields: FormField[];
  linkModule: LinkModule | null;
  cadenceDays: number | null;
  status: 'active' | 'archived';
  version: number;
  updatedAt: Date | null;
}

export interface TemplateFields {
  name?: string;
  description?: string;
  category?: FormCategory;
  fields?: FormField[];
  linkModule?: LinkModule | null;
  cadenceDays?: number | null;
  status?: 'active' | 'archived';
}

export interface Flag {
  kind: 'signer_not_on_site' | 'overdue';
  message: string;
  templateId: string;
  templateName: string;
  formId: string | null;
  signerNames: string[];
}

const FLAG_WINDOW_DAYS = 14;

const fromLibrary = (t: LibraryTemplate): TemplateView => ({
  id: libraryId(t.key),
  source: 'library',
  name: t.name,
  description: t.description,
  category: t.category,
  fields: t.fields,
  linkModule: t.linkModule,
  cadenceDays: t.cadenceDays,
  status: 'active',
  version: 1,
  updatedAt: null,
});

const fromRow = (r: TemplateRow): TemplateView => ({
  id: encodeId('formTemplate', r.id),
  source: 'custom',
  name: r.name,
  description: r.description,
  category: r.category,
  fields: r.fields,
  linkModule: r.linkModule,
  cadenceDays: r.cadenceDays,
  status: r.status,
  version: r.version,
  updatedAt: r.updatedAt,
});

function invalid(
  problems: { path: string; message: string }[],
  message = 'Check the form.',
): never {
  throw new AppError('validation_failed', message, problems);
}

export function createFormsService(deps: FormsDeps) {
  const now = deps.now ?? (() => new Date());

  // ---- templates -----------------------------------------------------------------------------------------------

  async function listTemplates(scope: TenantScope, opts: { includeArchived: boolean }) {
    const rows = await scope.tx
      .select()
      .from(templates)
      .where(opts.includeArchived ? undefined : eq(templates.status, 'active'))
      .orderBy(asc(templates.name))
      .limit(500);
    // A built-in template the organisation has copied is replaced by its copy (while the copy is in use).
    const copied = new Set(rows.filter((r) => r.status === 'active').map((r) => r.copiedFrom));
    const all = [
      ...LIBRARY.filter((l) => !copied.has(libraryId(l.key))).map(fromLibrary),
      ...rows.map(fromRow),
    ];
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getTemplateRow(scope: TenantScope, id: string) {
    const [row] = await scope.tx.select().from(templates).where(eq(templates.id, id)).limit(1);
    if (!row) throw new AppError('form.template_not_found');
    return row;
  }

  /** `library:<key>` or an encoded custom template id. */
  async function resolveTemplate(scope: TenantScope, ref: string): Promise<TemplateView> {
    if (ref.startsWith('library:')) {
      const t = findLibrary(ref.slice('library:'.length));
      if (!t) throw new AppError('form.template_not_found');
      return fromLibrary(t);
    }
    const id = decodeId('formTemplate', ref);
    if (!id) throw new AppError('form.template_not_found');
    return fromRow(await getTemplateRow(scope, id));
  }

  async function createTemplate(
    scope: TenantScope,
    input: TemplateFields & { copyFromLibraryKey?: string },
  ) {
    let base: TemplateFields = {};
    let copiedFrom: string | null = null;
    if (input.copyFromLibraryKey) {
      const lib = findLibrary(input.copyFromLibraryKey);
      if (!lib) throw new AppError('form.template_not_found');
      base = {
        name: lib.name,
        description: lib.description,
        category: lib.category,
        fields: lib.fields,
        linkModule: lib.linkModule,
        cadenceDays: lib.cadenceDays,
      };
      copiedFrom = libraryId(lib.key);
    }
    const f = { ...base, ...stripUndefined(input) };
    const name = f.name?.trim();
    if (!name) invalid([{ path: 'name', message: 'Give the template a name' }]);
    const fields = f.fields ?? [];
    const problems = fieldListProblems(fields);
    if (problems.length) invalid(problems);
    await assertNameFree(scope, name!, null);
    const [row] = await scope.tx
      .insert(templates)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        name: name!,
        description: f.description ?? '',
        category: f.category ?? 'general',
        fields,
        linkModule: f.linkModule ?? null,
        cadenceDays: f.cadenceDays ?? null,
        copiedFrom,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return fromRow(row!);
  }

  async function assertNameFree(scope: TenantScope, name: string, exceptId: string | null) {
    const clash = await scope.tx
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.status, 'active'), sql`lower(${templates.name}) = lower(${name})`))
      .limit(2);
    if (clash.some((c) => c.id !== exceptId))
      throw new AppError('conflict', 'A template with this name already exists.', [
        { path: 'name', message: 'Choose another name' },
      ]);
  }

  async function updateTemplate(
    scope: TenantScope,
    ref: string,
    expectedVersion: number,
    patch: TemplateFields,
  ) {
    const id = decodeId('formTemplate', ref);
    if (!id) throw new AppError('form.template_not_found');
    const row = await getTemplateRow(scope, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (patch.name !== undefined) {
      if (!patch.name.trim()) invalid([{ path: 'name', message: 'Give the template a name' }]);
      if (patch.status !== 'archived') await assertNameFree(scope, patch.name.trim(), id);
    }
    if (patch.fields) {
      const problems = fieldListProblems(patch.fields);
      if (problems.length) invalid(problems);
    }
    if (patch.status === 'active' && row.status === 'archived')
      await assertNameFree(scope, patch.name?.trim() ?? row.name, id);
    const [next] = await scope.tx
      .update(templates)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.fields !== undefined ? { fields: patch.fields } : {}),
        ...(patch.linkModule !== undefined ? { linkModule: patch.linkModule } : {}),
        ...(patch.cadenceDays !== undefined ? { cadenceDays: patch.cadenceDays } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
        version: sql`${templates.version} + 1`,
      })
      .where(and(eq(templates.id, id), eq(templates.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    return fromRow(next);
  }

  // ---- forms ---------------------------------------------------------------------------------------------------

  async function getForm(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(forms)
      .where(and(eq(forms.id, id), eq(forms.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('form.not_found');
    return row;
  }

  async function names(ids: readonly string[]) {
    const users = await deps.identity.getUsers([...new Set(ids)]);
    return new Map([...users].map(([id, u]) => [id, u.name || u.email]));
  }

  async function signatureCounts(scope: TenantScope, formIds: readonly string[]) {
    const out = new Map<string, number>();
    if (formIds.length === 0) return out;
    const rows = await scope.tx
      .select({ formId: signatures.formId, n: sql<number>`count(*)::int` })
      .from(signatures)
      .where(inArray(signatures.formId, [...formIds]))
      .groupBy(signatures.formId);
    for (const r of rows) out.set(r.formId, r.n);
    return out;
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { templateId?: string; status?: 'draft' | 'submitted'; limit: number; cursor?: string },
  ) {
    await deps.platform.getProject(scope, projectId);
    const after = decodeCursor<{ t: string; id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(forms.projectId, projectId)];
    if (opts.templateId) conditions.push(eq(forms.templateRef, opts.templateId));
    if (opts.status) conditions.push(eq(forms.status, opts.status));
    if (after) {
      const t = new Date(after.t);
      conditions.push(
        or(lt(forms.createdAt, t), and(eq(forms.createdAt, t), lt(forms.id, after.id)))!,
      );
    }
    const rows = await scope.tx
      .select()
      .from(forms)
      .where(and(...conditions))
      .orderBy(desc(forms.createdAt), desc(forms.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ t: r.createdAt.toISOString(), id: r.id }));
    const [counts, who] = await Promise.all([
      signatureCounts(
        scope,
        page.data.map((r) => r.id),
      ),
      names(page.data.map((r) => r.createdBy)),
    ]);
    return { data: page.data, counts, names: who, nextCursor: page.nextCursor };
  }

  async function start(
    scope: TenantScope,
    projectId: string,
    input: { templateId: string; title?: string },
  ) {
    const project = await deps.platform.getProject(scope, projectId);
    const t = await resolveTemplate(scope, input.templateId);
    if (t.status === 'archived')
      throw new AppError('form.template_locked', 'This template has been archived.');
    const at = now();
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'form');
    const formDate = localDateOf(at, project.timezone);
    await scope.tx.insert(forms).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      number,
      templateRef: t.id,
      templateName: t.name,
      category: t.category,
      linkModule: t.linkModule,
      fields: t.fields,
      title: input.title?.trim() || `${t.name} ${formDate}`,
      formDate,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return detail(scope, projectId, id);
  }

  async function sigsOf(scope: TenantScope, formId: string) {
    return scope.tx
      .select()
      .from(signatures)
      .where(eq(signatures.formId, formId))
      .orderBy(asc(signatures.signedAt), asc(signatures.id));
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const row = await getForm(scope, projectId, id);
    const sigs = await sigsOf(scope, id);
    const who = await names([row.createdBy]);
    const flags = await formFlags(scope, projectId, row, sigs);
    return { row, signatures: sigs, names: who, flags };
  }

  async function formFlags(
    scope: TenantScope,
    projectId: string,
    row: FormRow,
    sigs: readonly SignatureRow[],
  ): Promise<Flag[]> {
    if (row.category !== 'safety' || sigs.length === 0) return [];
    const attendance = await deps.attendance(scope, projectId, {
      from: row.formDate,
      to: row.formDate,
    });
    return flagFor(row, sigs, attendance);
  }

  function flagFor(
    row: FormRow,
    sigs: readonly SignatureRow[],
    attendance: AttendanceRow[],
  ): Flag[] {
    const missing = signersNotOnSite(
      sigs.map((s) => s.signerName),
      row.formDate,
      attendance,
    );
    if (missing.length === 0) return [];
    return [
      {
        kind: 'signer_not_on_site',
        message: `${missing.join(', ')} signed ${row.templateName} but ${missing.length === 1 ? "isn't" : "aren't"} signed in to site on ${row.formDate}. Check the sign-in or the name.`,
        templateId: row.templateRef,
        templateName: row.templateName,
        formId: encodeId('form', row.id),
        signerNames: missing,
      },
    ];
  }

  async function save(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: { title?: string; answers?: Answers },
  ) {
    const row = await getForm(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (row.status === 'submitted') throw new AppError('form.already_submitted');
    let answers = row.answers;
    if (patch.answers) {
      const cleaned = cleanAnswers(row.fields, patch.answers);
      if (cleaned.problems.length) invalid(cleaned.problems);
      answers = { ...row.answers, ...cleaned.answers };
      for (const f of row.fields)
        if (f.key in patch.answers && patch.answers[f.key] === null) delete answers[f.key];
    }
    const [next] = await scope.tx
      .update(forms)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() || row.title } : {}),
        answers,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
        version: sql`${forms.version} + 1`,
      })
      .where(and(eq(forms.id, id), eq(forms.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    return detail(scope, projectId, id);
  }

  async function sign(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { fieldKey: string; signerName: string },
  ) {
    const row = await getForm(scope, projectId, id);
    if (row.status === 'submitted') throw new AppError('form.already_submitted');
    const field = row.fields.find((f) => f.key === input.fieldKey && f.type === 'signature');
    if (!field) invalid([{ path: 'fieldKey', message: 'This form has no such signature field' }]);
    const name = input.signerName.trim().replace(/\s+/g, ' ');
    if (!name) invalid([{ path: 'signerName', message: 'Enter the name of the person signing' }]);
    const slots = field!.slots ?? 1;
    const existing = await scope.tx
      .select({ key: signatures.signerKey })
      .from(signatures)
      .where(and(eq(signatures.formId, id), eq(signatures.fieldKey, input.fieldKey)));
    const signerKey = normaliseName(name);
    if (existing.some((e) => e.key === signerKey))
      throw new AppError('conflict', `${name} has already signed here.`, [
        { path: 'signerName', message: 'Already signed' },
      ]);
    if (existing.length >= slots)
      throw new AppError('conflict', 'Every signature slot is taken.', [
        { path: 'fieldKey', message: 'No slots left' },
      ]);
    await scope.tx.insert(signatures).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      formId: id,
      fieldKey: input.fieldKey,
      signerName: name,
      signerKey,
      signerUserId: null,
      signedAt: now(),
    });
    await scope.tx
      .update(forms)
      .set({ updatedAt: now(), updatedBy: scope.ctx.userId, version: sql`${forms.version} + 1` })
      .where(eq(forms.id, id));
    return detail(scope, projectId, id);
  }

  async function submit(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
  ) {
    const row = await getForm(scope, projectId, id);
    if (row.version !== expectedVersion) throw versionConflict();
    if (row.status === 'submitted') throw new AppError('form.already_submitted');
    const sigs = await sigsOf(scope, id);
    const counts = new Map<string, number>();
    for (const s of sigs) counts.set(s.fieldKey, (counts.get(s.fieldKey) ?? 0) + 1);
    const missing = missingForSubmit(row.fields, row.answers, counts);
    if (missing.length)
      throw new AppError(
        'form.incomplete',
        'Fill in the required fields before submitting.',
        missing,
      );
    const [next] = await scope.tx
      .update(forms)
      .set({
        status: 'submitted',
        submittedAt: now(),
        submittedBy: scope.ctx.userId,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
        version: sql`${forms.version} + 1`,
      })
      .where(and(eq(forms.id, id), eq(forms.version, expectedVersion)))
      .returning();
    if (!next) throw versionConflict();
    return detail(scope, projectId, id);
  }

  // ---- Nova flags ----------------------------------------------------------------------------------------------

  async function attention(scope: TenantScope, projectId: string): Promise<Flag[]> {
    const project = await deps.platform.getProject(scope, projectId);
    const today = localDateOf(now(), project.timezone);
    const from = addDays(today, -(FLAG_WINDOW_DAYS - 1));
    const attendance = await deps.attendance(scope, projectId, { from, to: today });
    const out: Flag[] = [];

    const recent = await scope.tx
      .select()
      .from(forms)
      .where(
        and(
          eq(forms.projectId, projectId),
          eq(forms.category, 'safety'),
          gte(forms.formDate, from),
        ),
      )
      .orderBy(desc(forms.createdAt))
      .limit(200);
    const sigs = recent.length
      ? await scope.tx
          .select()
          .from(signatures)
          .where(
            inArray(
              signatures.formId,
              recent.map((r) => r.id),
            ),
          )
      : [];
    for (const f of recent)
      out.push(
        ...flagFor(
          f,
          sigs.filter((s) => s.formId === f.id),
          attendance,
        ),
      );

    for (const t of await listTemplates(scope, { includeArchived: false })) {
      if (!t.cadenceDays) continue;
      const [last] = await scope.tx
        .select({ d: sql<string | null>`max(${forms.formDate})` })
        .from(forms)
        .where(
          and(
            eq(forms.projectId, projectId),
            eq(forms.templateRef, t.id),
            eq(forms.status, 'submitted'),
          ),
        );
      if (
        isOverdue({
          cadenceDays: t.cadenceDays,
          today,
          lastSubmittedDate: last?.d ?? null,
          attendance,
        })
      )
        out.push({
          kind: 'overdue',
          message: `${t.name} is overdue: the crew has been on site in the last ${t.cadenceDays} days with none submitted.`,
          templateId: t.id,
          templateName: t.name,
          formId: null,
          signerNames: [],
        });
    }
    return out;
  }

  return {
    listTemplates,
    createTemplate,
    updateTemplate,
    list,
    start,
    detail,
    save,
    sign,
    submit,
    attention,
  };
}

export type FormsService = ReturnType<typeof createFormsService>;

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
