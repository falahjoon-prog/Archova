import type { ProblemCode } from '@archova/contracts';
import { decodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type Logger,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { AttendanceService } from '../application/attendance';
import { aiContent, type InductionService } from '../application/inductions';
import {
  fromContentDto,
  toCompletionDto,
  toCredentialDto,
  toInductionDto,
  toRegisterDto,
  toVersionDto,
} from './induction-mappers';
import {
  toEntryDto,
  toGateDto,
  toRollCallDto,
  toSessionDto,
  toSignInDto,
  toSiteDto,
  toWorkerDto,
} from './mappers';

const id = (kind: IdKind, value: string, notFound: ProblemCode) => {
  const uuid = decodeId(kind, value);
  if (!uuid) throw new AppError(notFound);
  return uuid;
};
const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};
const project = (p: { projectId: string }) => id('project', p.projectId, 'project.not_found');
const date = (v: string | undefined) => (v ? new Date(v) : undefined);
const induction = (p: { inductionId: string }) =>
  id('induction', p.inductionId, 'induction.not_found');
const completion = (p: { completionId: string }) =>
  id('inductionCompletion', p.completionId, 'induction.completion_not_found');
const credentialInput = (b: {
  kind: 'white_card' | 'high_risk_licence' | 'trade_licence' | 'other';
  number: string;
  issuingState?: string;
  licenceClass?: string;
  issuedOn?: string;
  expiresOn?: string;
  fileIds: string[];
}) => ({
  ...b,
  fileIds: b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`)),
});
const companyOrNull = (v: string | null | undefined, path: string) =>
  v === undefined ? undefined : v === null ? null : ref('company', v, path);

/** Work done after a commit, outside the transaction. */
export interface InductionHooks {
  logger?: Pick<Logger, 'warn'>;
  /** Index a published version for worker Q&A (`ai.api.indexInductionVersion`); idempotent, retried on the next publish. */
  onVersionPublished?: (
    ctx: TenantContext,
    content: ReturnType<typeof aiContent>,
  ) => Promise<unknown>;
}

export function workforceRoutes(
  database: Database,
  svc: AttendanceService,
  ind: InductionService,
  hooks: InductionHooks = {},
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  return defineRoutes({
    listAttendanceSites: async (input) => {
      const rows = await read(input, (s) => svc.listSites(s, project(input.params)));
      return { status: 200, body: { data: rows.map((r) => toSiteDto(r.site, r.gates)) } };
    },
    createAttendanceSite: async (input) => {
      const b = input.body;
      const row = await tx(input, (s) =>
        svc.createSite(s, project(input.params), {
          name: b.name,
          ...(b.boundary !== undefined ? { boundary: b.boundary } : {}),
          ...(b.dayEndLocal ? { dayEndLocal: b.dayEndLocal } : {}),
          ...(b.gateCheckMode ? { gateCheckMode: b.gateCheckMode } : {}),
        }),
      );
      return { status: 201, body: toSiteDto(row, []), headers: { etag: etag(row.version) } };
    },
    updateAttendanceSite: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      const r = await tx(input, async (s) => {
        const p = project(input.params);
        const row = await svc.updateSite(
          s,
          p,
          id('workforceSite', input.params.siteId, 'workforce_site.not_found'),
          expected,
          {
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.boundary !== undefined ? { boundary: b.boundary } : {}),
            ...(b.dayEndLocal !== undefined ? { dayEndLocal: b.dayEndLocal } : {}),
            ...(b.gateCheckMode !== undefined ? { gateCheckMode: b.gateCheckMode } : {}),
            ...(b.active !== undefined ? { active: b.active } : {}),
          },
        );
        const all = await svc.listSites(s, p);
        return { row, gates: all.find((x) => x.site.id === row.id)?.gates ?? [] };
      });
      return {
        status: 200,
        body: toSiteDto(r.row, r.gates),
        headers: { etag: etag(r.row.version) },
      };
    },
    createGate: async (input) => {
      const r = await tx(input, (s) =>
        svc.createGate(
          s,
          project(input.params),
          id('workforceSite', input.params.siteId, 'workforce_site.not_found'),
          input.body.name,
        ),
      );
      return {
        status: 201,
        body: { gate: toGateDto(r.gate), code: r.qrToken },
        headers: { etag: etag(r.gate.version) },
      };
    },
    updateGate: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const row = await tx(input, (s) =>
        svc.updateGate(
          s,
          project(input.params),
          id('gate', input.params.gateId, 'gate.not_found'),
          expected,
          input.body,
        ),
      );
      return { status: 200, body: toGateDto(row), headers: { etag: etag(row.version) } };
    },
    reissueGateCode: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const r = await tx(input, (s) =>
        svc.reissueGate(
          s,
          project(input.params),
          id('gate', input.params.gateId, 'gate.not_found'),
          expected,
        ),
      );
      return {
        status: 200,
        body: { gate: toGateDto(r.gate), code: r.qrToken },
        headers: { etag: etag(r.gate.version) },
      };
    },
    listWorkers: async (input) => {
      const q = input.query;
      const r = await read(input, (s) =>
        svc.listWorkers(s, project(input.params), {
          ...(q.companyId ? { companyId: ref('company', q.companyId, 'companyId') } : {}),
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.q ? { q: q.q } : {}),
        }),
      );
      return { status: 200, body: { data: r.rows.map((w) => toWorkerDto(w, r.viewer)) } };
    },
    createWorker: async (input) => {
      const b = input.body;
      const r = await tx(input, (s) =>
        svc.createWorker(s, project(input.params), {
          fullName: b.fullName,
          ...(b.companyId !== undefined
            ? { companyId: companyOrNull(b.companyId, 'companyId')! }
            : {}),
          ...(b.companyNameOther !== undefined ? { companyNameOther: b.companyNameOther } : {}),
          ...(b.phone !== undefined ? { phone: b.phone } : {}),
          ...(b.email !== undefined ? { email: b.email } : {}),
          ...(b.kind ? { kind: b.kind } : {}),
        }),
      );
      return {
        status: 201,
        body: toWorkerDto(r.row, r.viewer),
        headers: { etag: etag(r.row.version) },
      };
    },
    updateWorker: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      const r = await tx(input, (s) =>
        svc.updateWorker(
          s,
          project(input.params),
          id('worker', input.params.workerId, 'worker.not_found'),
          expected,
          {
            ...(b.fullName !== undefined ? { fullName: b.fullName } : {}),
            ...(b.companyId !== undefined
              ? { companyId: companyOrNull(b.companyId, 'companyId')! }
              : {}),
            ...(b.companyNameOther !== undefined ? { companyNameOther: b.companyNameOther } : {}),
            ...(b.phone !== undefined ? { phone: b.phone } : {}),
            ...(b.email !== undefined ? { email: b.email } : {}),
            ...(b.kind !== undefined ? { kind: b.kind } : {}),
            ...(b.status !== undefined ? { status: b.status } : {}),
          },
        ),
      );
      return {
        status: 200,
        body: toWorkerDto(r.row, r.viewer),
        headers: { etag: etag(r.row.version) },
      };
    },
    signInSelf: async (input) => {
      const b = input.body;
      const r = await tx(input, (s) =>
        svc.selfSignIn(s, project(input.params), {
          gateToken: b.gateCode,
          ...(b.clientAt ? { clientAt: date(b.clientAt)! } : {}),
          location: b.location ?? null,
          offline: b.offline ?? false,
        }),
      );
      return { status: 200, body: toSignInDto(r, null) };
    },
    signOutSelf: async (input) => {
      const b = input.body ?? {};
      const row = await tx(input, (s) =>
        svc.selfSignOut(s, project(input.params), {
          ...(b.gateCode ? { gateToken: b.gateCode } : {}),
          ...(b.clientAt ? { clientAt: date(b.clientAt)! } : {}),
        }),
      );
      return { status: 200, body: toSessionDto(row) };
    },
    recordAttendance: async (input) => {
      const b = input.body;
      const r = await tx(input, async (s) => {
        const p = project(input.params);
        const result = await svc.record(s, p, {
          workerId: ref('worker', b.workerId, 'workerId'),
          kind: b.kind,
          ...(b.siteId ? { siteId: ref('workforceSite', b.siteId, 'siteId') } : {}),
          ...(b.clientAt ? { clientAt: date(b.clientAt)! } : {}),
          ...(b.overrideReason ? { overrideReason: b.overrideReason } : {}),
        });
        return { result, viewer: await svc.viewer(s, p) };
      });
      return { status: 200, body: toSignInDto(r.result, r.viewer) };
    },
    getOnSite: async (input) => {
      const r = await read(input, (s) =>
        svc.onSite(
          s,
          project(input.params),
          input.query.siteId ? ref('workforceSite', input.query.siteId, 'siteId') : undefined,
        ),
      );
      const companies = new Map<
        string,
        { companyId: string | null; companyNameOther: string | null; count: number }
      >();
      for (const e of r.entries) {
        const key = e.worker.companyId ?? `other:${e.worker.companyNameOther ?? ''}`;
        const c = companies.get(key) ?? {
          companyId: e.worker.companyId
            ? (toWorkerDto(e.worker, r.viewer).companyId as string)
            : null,
          companyNameOther: e.worker.companyId ? null : e.worker.companyNameOther,
          count: 0,
        };
        c.count++;
        companies.set(key, c);
      }
      return {
        status: 200,
        body: {
          total: r.entries.length,
          companies: [...companies.values()],
          people: r.entries.map((e) => toEntryDto(e, r.viewer)),
        },
      };
    },
    listAttendanceSessions: async (input) => {
      const q = input.query;
      const r = await read(input, (s) =>
        svc.sessionsForDay(s, project(input.params), {
          date: q.date,
          ...(q.siteId ? { siteId: ref('workforceSite', q.siteId, 'siteId') } : {}),
          ...(q.companyId ? { companyId: ref('company', q.companyId, 'companyId') } : {}),
        }),
      );
      return { status: 200, body: { data: r.entries.map((e) => toEntryDto(e, r.viewer)) } };
    },
    startRollCall: async (input) => {
      const b = input.body;
      const r = await tx(input, (s) =>
        svc.startRollCall(s, project(input.params), {
          reason: b.reason,
          ...(b.siteId ? { siteId: ref('workforceSite', b.siteId, 'siteId') } : {}),
        }),
      );
      return { status: 201, body: toRollCallDto(r.call, r.marks) };
    },
    getRollCall: async (input) => {
      const r = await read(input, (s) =>
        svc.getRollCall(
          s,
          project(input.params),
          id('rollCall', input.params.rollCallId, 'roll_call.not_found'),
        ),
      );
      return { status: 200, body: toRollCallDto(r.call, r.marks) };
    },
    markRollCall: async (input) => {
      const r = await tx(input, (s) =>
        svc.markRollCall(
          s,
          project(input.params),
          id('rollCall', input.params.rollCallId, 'roll_call.not_found'),
          {
            workerId: ref('worker', input.body.workerId, 'workerId'),
            status: input.body.status,
          },
        ),
      );
      return { status: 200, body: toRollCallDto(r.call, r.marks) };
    },
    endRollCall: async (input) => {
      const r = await tx(input, (s) =>
        svc.endRollCall(
          s,
          project(input.params),
          id('rollCall', input.params.rollCallId, 'roll_call.not_found'),
        ),
      );
      return { status: 200, body: toRollCallDto(r.call, r.marks) };
    },

    // ------------------------------------------------------------------------------------- inductions

    listInductions: async (input) => {
      const rows = await read(input, (s) => ind.list(s, project(input.params)));
      return { status: 200, body: { data: rows.map(toInductionDto) } };
    },
    createInduction: async (input) => {
      const b = input.body;
      const d = await tx(input, (s) =>
        ind.create(s, project(input.params), {
          title: b.title,
          ...(b.siteId ? { siteId: ref('workforceSite', b.siteId, 'siteId') } : {}),
          ...(b.validityMonths ? { validityMonths: b.validityMonths } : {}),
        }),
      );
      return { status: 201, body: toInductionDto(d), headers: { etag: etag(d.row.version) } };
    },
    getInduction: async (input) => {
      const d = await read(input, (s) =>
        ind.get(s, project(input.params), induction(input.params)),
      );
      return { status: 200, body: toInductionDto(d), headers: { etag: etag(d.row.version) } };
    },
    updateInduction: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const d = await tx(input, (s) =>
        ind.update(s, project(input.params), induction(input.params), expected, input.body),
      );
      return { status: 200, body: toInductionDto(d), headers: { etag: etag(d.row.version) } };
    },
    saveInductionDraft: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      const content = fromContentDto(b.content);
      const d = await tx(input, (s) =>
        ind.saveDraft(s, project(input.params), induction(input.params), expected, {
          content,
          ...(b.aiSuggestionId
            ? { aiSuggestionId: ref('aiSuggestion', b.aiSuggestionId, 'aiSuggestionId') }
            : {}),
        }),
      );
      return { status: 200, body: toInductionDto(d), headers: { etag: etag(d.row.version) } };
    },
    approveInductionSection: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const d = await tx(input, (s) =>
        ind.approveSection(
          s,
          project(input.params),
          induction(input.params),
          expected,
          input.body.section,
        ),
      );
      return { status: 200, body: toInductionDto(d), headers: { etag: etag(d.row.version) } };
    },
    publishInduction: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const ctx = requireTenant(input);
      const r = await tx(input, (s) =>
        ind.publish(s, project(input.params), induction(input.params), expected, input.body),
      );
      if (hooks.onVersionPublished)
        await hooks
          .onVersionPublished(ctx, aiContent(r.version))
          .catch((err: unknown) =>
            hooks.logger?.warn(
              { orgId: ctx.orgId, versionId: r.version.id, err },
              'induction version not indexed for Nova; it is indexed again on the next publish',
            ),
          );
      return {
        status: 201,
        body: toVersionDto(r.version),
        headers: { etag: etag(r.induction.version) },
      };
    },
    getInductionVersion: async (input) => {
      const v = await read(input, (s) =>
        ind.getVersion(
          s,
          project(input.params),
          induction(input.params),
          id('inductionVersion', input.params.versionId, 'induction.version_not_found'),
        ),
      );
      return { status: 200, body: toVersionDto(v) };
    },
    listInductionRegister: async (input) => {
      const r = await read(input, (s) =>
        ind.register(
          s,
          project(input.params),
          input.query.siteId ? ref('workforceSite', input.query.siteId, 'siteId') : undefined,
        ),
      );
      return { status: 200, body: toRegisterDto(r, r.viewer) };
    },
    startInduction: async (input) => {
      const b = input.body ?? {};
      const v = await tx(input, (s) =>
        ind.start(s, project(input.params), {
          ...(b.siteId ? { siteId: ref('workforceSite', b.siteId, 'siteId') } : {}),
          ...(b.workerId ? { workerId: ref('worker', b.workerId, 'workerId') } : {}),
        }),
      );
      return { status: 200, body: toCompletionDto(v) };
    },
    getInductionCompletion: async (input) => {
      const v = await read(input, (s) =>
        ind.getCompletion(s, project(input.params), completion(input.params)),
      );
      return { status: 200, body: toCompletionDto(v) };
    },
    recordInductionProgress: async (input) => {
      const v = await tx(input, (s) =>
        ind.recordProgress(s, project(input.params), completion(input.params), input.body),
      );
      return { status: 200, body: toCompletionDto(v) };
    },
    submitInductionQuiz: async (input) => {
      const r = await tx(input, (s) =>
        ind.submitQuiz(s, project(input.params), completion(input.params), input.body.answers),
      );
      return {
        status: 200,
        body: {
          attempt: r.attempt,
          score: r.score,
          passed: r.passed,
          criticalMissed: !r.criticalOk,
          reviewSections: r.reviewSections,
          seeSiteOffice: r.seeSiteOffice,
        },
      };
    },
    addInductionCredential: async (input) => {
      const row = await tx(input, (s) =>
        ind.addInductionCredential(
          s,
          project(input.params),
          completion(input.params),
          credentialInput(input.body),
        ),
      );
      return { status: 201, body: toCredentialDto(row) };
    },
    signInduction: async (input) => {
      const b = input.body;
      const v = await tx(input, (s) =>
        ind.sign(
          s,
          project(input.params),
          completion(input.params),
          {
            typedName: b.typedName,
            signature: b.signature,
            fitForWork: b.fitForWork,
            agreed: b.agreed,
            ...(b.clientAt ? { clientAt: date(b.clientAt)! } : {}),
          },
          { ip: input.ip, userAgent: input.userAgent },
        ),
      );
      return { status: 200, body: toCompletionDto(v) };
    },
    listWorkerCredentials: async (input) => {
      const rows = await read(input, (s) =>
        ind.listCredentials(
          s,
          project(input.params),
          id('worker', input.params.workerId, 'worker.not_found'),
        ),
      );
      return { status: 200, body: { data: rows.map(toCredentialDto) } };
    },
    addWorkerCredential: async (input) => {
      const row = await tx(input, (s) =>
        ind.addCredential(
          s,
          project(input.params),
          id('worker', input.params.workerId, 'worker.not_found'),
          credentialInput(input.body),
        ),
      );
      return { status: 201, body: toCredentialDto(row), headers: { etag: etag(row.version) } };
    },
    sightWorkerCredential: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const row = await tx(input, (s) =>
        ind.sightCredential(
          s,
          project(input.params),
          id('worker', input.params.workerId, 'worker.not_found'),
          id('workerCredential', input.params.credentialId, 'credential.not_found'),
          expected,
        ),
      );
      return { status: 200, body: toCredentialDto(row), headers: { etag: etag(row.version) } };
    },
  });
}
