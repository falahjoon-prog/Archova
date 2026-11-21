// T&M (daywork) tickets against the financials endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';

type S = components['schemas'];
export type TmTicket = S['TmTicket'];
export type TmTicketDetail = S['TmTicketDetail'];
export type TmTicketList = S['TmTicketList'];
export type TmTicketRequest = S['TmTicketRequest'];
export type TmLineRequest = S['TmTicketLineRequest'];
export type TmSuggestion = S['TmTicketSuggestion'];
export type SignTmTicket = S['SignTmTicketRequest'];
export type TmChecks = S['TmTicketChecks'];
export type ConvertTmTicket = S['ConvertTmTicketRequest'];
/** What the form sends: the docket photo and the signature image are uploaded first and attached by id. */
export type SignInput = Omit<
  SignTmTicket,
  'evidenceFileId' | 'signatureFileId' | 'signatureMethod'
> & {
  evidence?: File;
  signature?: { image: Blob; method: 'drawn' | 'typed' };
};
export type ReviewTmTicket = S['ReviewTmTicketRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createTmApi(orgId: string) {
  return {
    async list(projectId: string): Promise<TmTicketList> {
      return unwrap(await api.GET(`${P}/tm-tickets`, { params: { path: { orgId, projectId } } }));
    },
    async get(projectId: string, tmTicketId: string): Promise<TmTicketDetail> {
      return unwrap(
        await api.GET(`${P}/tm-tickets/{tmTicketId}`, {
          params: { path: { orgId, projectId, tmTicketId } },
        }),
      );
    },
    async checks(projectId: string, tmTicketId: string): Promise<TmChecks> {
      return unwrap(
        await api.GET(`${P}/tm-tickets/{tmTicketId}/checks`, {
          params: { path: { orgId, projectId, tmTicketId } },
        }),
      );
    },
    async suggest(projectId: string, date: string): Promise<TmSuggestion> {
      return unwrap(
        await api.GET(`${P}/tm-tickets/suggestion`, {
          params: { path: { orgId, projectId }, query: { date } },
        }),
      );
    },
    async create(projectId: string, body: TmTicketRequest): Promise<TmTicketDetail> {
      return unwrap(
        await api.POST(`${P}/tm-tickets`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    /** `evidence` is the photo of the docket signed on site; it is uploaded first and attached by id. */
    async sign(projectId: string, tmTicketId: string, input: SignInput): Promise<TmTicketDetail> {
      const { evidence, signature, ...rest } = input;
      const body: SignTmTicket = { ...rest };
      if (evidence)
        body.evidenceFileId = (
          await uploadFile(orgId, { file: evidence, projectId, module: 'financials' })
        ).id;
      if (signature) {
        const file = new File([signature.image], 'signature.png', { type: 'image/png' });
        body.signatureFileId = (
          await uploadFile(orgId, { file, projectId, module: 'financials' })
        ).id;
        body.signatureMethod = signature.method;
      }
      return unwrap(
        await api.POST(`${P}/tm-tickets/{tmTicketId}/sign`, {
          params: { path: { orgId, projectId, tmTicketId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async review(
      projectId: string,
      tmTicketId: string,
      body: ReviewTmTicket,
    ): Promise<TmTicketDetail> {
      return unwrap(
        await api.POST(`${P}/tm-tickets/{tmTicketId}/review`, {
          params: { path: { orgId, projectId, tmTicketId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async voidTicket(projectId: string, tmTicketId: string, note: string): Promise<TmTicketDetail> {
      return unwrap(
        await api.POST(`${P}/tm-tickets/{tmTicketId}/void`, {
          params: { path: { orgId, projectId, tmTicketId }, header: idempotencyKey() },
          body: { note },
        }),
      );
    },
    async convert(
      projectId: string,
      tmTicketId: string,
      body: ConvertTmTicket,
    ): Promise<TmTicketDetail> {
      return unwrap(
        await api.POST(`${P}/tm-tickets/{tmTicketId}/convert`, {
          params: { path: { orgId, projectId, tmTicketId }, header: idempotencyKey() },
          body,
        }),
      );
    },
  };
}
