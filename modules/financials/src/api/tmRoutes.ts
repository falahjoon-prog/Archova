import { decodeId, encodeId, isUuid, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type {
  TmLineRow,
  TmSignoffRow,
  TmTicketRow,
  TmTicketsService,
} from '../application/tmTickets';
import { isMoney } from '../domain/money';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};
const rawId = (value: string, path: string) => {
  if (!isUuid(value))
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return value;
};
const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const ticketId = (p: { tmTicketId: string }) => ref('tmTicket', p.tmTicketId, 'tmTicketId');

const toTicketDto = (t: TmTicketRow) => ({
  id: encodeId('tmTicket', t.id),
  number: t.number,
  title: t.title,
  description: t.description,
  workDate: t.workDate,
  location: t.location,
  contractor: t.contractor,
  instructedBy: t.instructedBy,
  reference: t.reference,
  notes: t.notes,
  reviewStage: t.reviewStage,
  verifyNote: t.verifyNote,
  origin: t.origin,
  status: t.status,
  total: t.total,
  convertedTo: t.convertedTo,
  convertedAt: t.convertedAt?.toISOString() ?? null,
  variationId: t.variationId ? encodeId('variation', t.variationId) : null,
  voidReason: t.voidReason,
  createdAt: t.createdAt.toISOString(),
});
const toLineDto = (l: TmLineRow) => ({
  kind: l.kind,
  description: l.description,
  quantity: l.quantity,
  unit: l.unit,
  rate: l.rate,
  amount: l.amount,
  sourceType: l.sourceType,
  sourceId: l.sourceId,
});
const toSignoffDto = (s: TmSignoffRow) => ({
  role: s.role,
  signerName: s.signerName,
  signerPosition: s.signerPosition,
  geofenceStatus: s.geofenceStatus,
  hasPosition: s.lat !== null,
  hasEvidence: s.evidenceFileId !== null,
  evidenceFileId: s.evidenceFileId ? encodeId('file', s.evidenceFileId) : null,
  contentHash: s.contentHash,
  signedAt: s.signedAt.toISOString(),
});
const toDetail = (d: { ticket: TmTicketRow; lines: TmLineRow[]; signoffs: TmSignoffRow[] }) => ({
  ...toTicketDto(d.ticket),
  lines: d.lines.map(toLineDto),
  signoffs: d.signoffs.map(toSignoffDto),
});

type LineBody = {
  kind: 'labour' | 'equipment' | 'material';
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  sourceType?: 'timesheet_line' | 'equipment_log';
  sourceId?: string;
};
const toInput = (b: {
  title: string;
  description?: string;
  workDate: string;
  location?: string;
  contractor?: string;
  instructedBy?: string;
  reference?: string;
  notes?: string;
  origin?: 'manual' | 'nova';
  lines: LineBody[];
}) => ({
  title: b.title,
  ...(b.description ? { description: b.description } : {}),
  workDate: b.workDate,
  ...(b.location ? { location: b.location } : {}),
  ...(b.contractor ? { contractor: b.contractor } : {}),
  ...(b.instructedBy ? { instructedBy: b.instructedBy } : {}),
  ...(b.reference ? { reference: b.reference } : {}),
  ...(b.notes ? { notes: b.notes } : {}),
  ...(b.origin ? { origin: b.origin } : {}),
  lines: b.lines.map((l, i) => {
    if (!isMoney(l.rate))
      throw new AppError('validation_failed', 'Invalid amount', [
        { path: `lines.${i}.rate`, message: 'Invalid amount' },
      ]);
    return {
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      rate: l.rate,
      ...(l.sourceType && l.sourceId
        ? { sourceType: l.sourceType, sourceId: rawId(l.sourceId, `lines.${i}.sourceId`) }
        : {}),
    };
  }),
});

export function tmTicketRoutes(database: Database, tm: TmTicketsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  return defineRoutes({
    listTmTickets: async (input) => {
      const r = await read(input, (s) => tm.listTickets(s, project(input.params)));
      return {
        status: 200,
        body: {
          data: r.rows.map(toTicketDto),
          total: r.total,
          awaitingSignature: r.awaitingSignature,
          unconverted: r.unconverted,
        },
      };
    },
    createTmTicket: async (input) => ({
      status: 201,
      body: toDetail(
        await tx(input, (s) => tm.createTicket(s, project(input.params), toInput(input.body))),
      ),
    }),
    getTmTicket: async (input) => ({
      status: 200,
      body: toDetail(
        await read(input, (s) => tm.getTicket(s, project(input.params), ticketId(input.params))),
      ),
    }),
    updateTmTicket: async (input) => ({
      status: 200,
      body: toDetail(
        await tx(input, (s) =>
          tm.updateTicket(s, project(input.params), ticketId(input.params), toInput(input.body)),
        ),
      ),
    }),
    signTmTicket: async (input) => ({
      status: 200,
      body: toDetail(
        await tx(input, (s) =>
          tm.signTicket(s, project(input.params), ticketId(input.params), {
            role: input.body.role,
            signerName: input.body.signerName,
            ...(input.body.signerPosition ? { signerPosition: input.body.signerPosition } : {}),
            ...(input.body.evidenceFileId
              ? { evidenceFileId: ref('file', input.body.evidenceFileId, 'evidenceFileId') }
              : {}),
            ...(input.body.fix
              ? {
                  fix: {
                    lat: input.body.fix.lat,
                    lng: input.body.fix.lng,
                    ...(input.body.fix.accuracyM !== undefined
                      ? { accuracyM: input.body.fix.accuracyM }
                      : {}),
                  },
                }
              : {}),
            ip: input.ip ?? undefined,
            userAgent: input.userAgent ?? undefined,
          }),
        ),
      ),
    }),
    reviewTmTicket: async (input) => ({
      status: 200,
      body: toDetail(
        await tx(input, (s) =>
          tm.setStage(s, project(input.params), ticketId(input.params), {
            stage: input.body.stage,
            ...(input.body.note ? { note: input.body.note } : {}),
          }),
        ),
      ),
    }),
    voidTmTicket: async (input) => ({
      status: 200,
      body: toDetail(
        await tx(input, (s) =>
          tm.voidTicket(s, project(input.params), ticketId(input.params), input.body.note),
        ),
      ),
    }),
    convertTmTicket: async (input) => {
      const b = input.body;
      return {
        status: 200,
        body: toDetail(
          await tx(input, (s) =>
            tm.convertTicket(
              s,
              project(input.params),
              ticketId(input.params),
              b.to === 'direct_cost'
                ? {
                    to: 'direct_cost',
                    budgetLineId: ref('budgetLine', b.budgetLineId ?? '', 'budgetLineId'),
                  }
                : {
                    to: 'variation',
                    contractId: ref('contract', b.contractId ?? '', 'contractId'),
                  },
            ),
          ),
        ),
      };
    },
    getTmTicketChecks: async (input) => ({
      status: 200,
      body: {
        findings: await read(input, (s) =>
          tm.checks(s, project(input.params), ticketId(input.params)),
        ),
      },
    }),
    suggestTmTicket: async (input) => {
      const r = await read(input, (s) => tm.suggest(s, project(input.params), input.query.date));
      return { status: 200, body: r };
    },
  });
}
