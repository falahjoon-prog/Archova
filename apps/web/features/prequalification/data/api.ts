// Subcontractor prequalification (precon module): forms, a company's answers, the decision and the register.

import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import type { components } from '@archova/contracts/openapi';
import type { Answers, Prequalification, PrequalSummary, PrequalTemplate } from '../lib/types';

type S = components['schemas'];
export type TemplateFields = S['CreatePrequalTemplateRequest'];
export type TemplatePatch = S['UpdatePrequalTemplateRequest'];

const T = '/v1/orgs/{orgId}/prequal-templates' as const;
const F = '/v1/orgs/{orgId}/prequalifications' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createPrequalApi(orgId: string) {
  return {
    async templates(): Promise<PrequalTemplate[]> {
      return unwrap(await api.GET(T, { params: { path: { orgId } } })).data;
    },
    async createTemplate(body: TemplateFields): Promise<PrequalTemplate> {
      return unwrap(
        await api.POST(T, { params: { path: { orgId }, header: idempotencyKey() }, body }),
      );
    },
    async updateTemplate(t: PrequalTemplate, body: TemplatePatch): Promise<PrequalTemplate> {
      return unwrap(
        await api.PATCH(`${T}/{templateId}`, {
          params: { path: { orgId, templateId: t.id }, header: ifMatch(t.rowVersion) },
          body,
        }),
      );
    },
    async publishTemplate(t: PrequalTemplate): Promise<PrequalTemplate> {
      return unwrap(
        await api.POST(`${T}/{templateId}/publish`, {
          params: { path: { orgId, templateId: t.id }, header: ifMatch(t.rowVersion) },
        }),
      );
    },
    async newTemplateVersion(t: PrequalTemplate): Promise<PrequalTemplate> {
      return unwrap(
        await api.POST(`${T}/{templateId}/new-version`, {
          params: { path: { orgId, templateId: t.id }, header: idempotencyKey() },
        }),
      );
    },
    async settings(): Promise<{ requireForTenders: boolean }> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/prequalification-settings', {
          params: { path: { orgId } },
        }),
      );
    },
    async updateSettings(body: { requireForTenders: boolean }) {
      return unwrap(
        await api.PUT('/v1/orgs/{orgId}/prequalification-settings', {
          params: { path: { orgId } },
          body,
        }),
      );
    },
    async register(f: { state?: S['PrequalQualification']; trade?: string }) {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/prequalification-register', {
          params: {
            path: { orgId },
            query: {
              ...(f.state ? { state: f.state } : {}),
              ...(f.trade?.trim() ? { trade: f.trade.trim() } : {}),
            },
          },
        }),
      ).data;
    },
    async list(f: { companyId?: string; status?: S['PrequalStatus'] }): Promise<PrequalSummary[]> {
      return unwrap(
        await api.GET(F, {
          params: {
            path: { orgId },
            query: {
              ...(f.companyId ? { companyId: f.companyId } : {}),
              ...(f.status ? { status: f.status } : {}),
            },
          },
        }),
      ).data;
    },
    async get(prequalId: string): Promise<Prequalification> {
      return unwrap(await api.GET(`${F}/{prequalId}`, { params: { path: { orgId, prequalId } } }));
    },
    async create(body: S['CreatePrequalificationRequest']): Promise<Prequalification> {
      return unwrap(
        await api.POST(F, { params: { path: { orgId }, header: idempotencyKey() }, body }),
      );
    },
    async save(
      p: Prequalification,
      body: { answers?: Answers; trades?: string[] },
    ): Promise<Prequalification> {
      return unwrap(
        await api.PATCH(`${F}/{prequalId}`, {
          params: { path: { orgId, prequalId: p.id }, header: ifMatch(p.version) },
          body,
        }),
      );
    },
    async submit(p: Prequalification): Promise<Prequalification> {
      return unwrap(
        await api.POST(`${F}/{prequalId}/submit`, {
          params: { path: { orgId, prequalId: p.id }, header: ifMatch(p.version) },
        }),
      );
    },
    async approve(
      p: Prequalification,
      body: { note?: string; expiresOn?: string },
    ): Promise<Prequalification> {
      return unwrap(
        await api.POST(`${F}/{prequalId}/approve`, {
          params: { path: { orgId, prequalId: p.id }, header: ifMatch(p.version) },
          body,
        }),
      );
    },
    async reject(p: Prequalification, note: string): Promise<Prequalification> {
      return unwrap(
        await api.POST(`${F}/{prequalId}/reject`, {
          params: { path: { orgId, prequalId: p.id }, header: ifMatch(p.version) },
          body: { note },
        }),
      );
    },
    async companies() {
      const out: S['Company'][] = [];
      let cursor: string | undefined;
      do {
        const page = unwrap(
          await api.GET('/v1/orgs/{orgId}/companies', {
            params: { path: { orgId }, query: { limit: 200, ...(cursor ? { cursor } : {}) } },
          }),
        );
        out.push(...page.data);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return out;
    },
  };
}
