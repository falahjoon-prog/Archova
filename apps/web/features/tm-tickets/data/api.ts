// T&M (daywork) tickets against the financials endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type TmTicket = S['TmTicket'];
export type TmTicketDetail = S['TmTicketDetail'];
export type TmTicketList = S['TmTicketList'];
export type TmTicketRequest = S['TmTicketRequest'];
export type TmLineRequest = S['TmTicketLineRequest'];
export type TmSuggestion = S['TmTicketSuggestion'];
export type SignTmTicket = S['SignTmTicketRequest'];
export type ConvertTmTicket = S['ConvertTmTicketRequest'];

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
    async sign(projectId: string, tmTicketId: string, body: SignTmTicket): Promise<TmTicketDetail> {
      return unwrap(
        await api.POST(`${P}/tm-tickets/{tmTicketId}/sign`, {
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
