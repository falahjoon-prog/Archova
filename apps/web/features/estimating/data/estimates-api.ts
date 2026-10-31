// Cost library and estimate sheets against the estimating module's endpoints (product/10 EST-US10, EST-US11).
// The server works out every amount and total; this layer only carries the numbers across.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';

export type CostItem = components['schemas']['CostItem'];
export type CostRate = components['schemas']['CostRate'];
export type CostCategory = components['schemas']['CostCategory'];
export type Estimate = components['schemas']['Estimate'];
export type EstimateLine = components['schemas']['EstimateLine'];
export type EstimateSummary = components['schemas']['EstimateSummary'];
export type EstimateLineInput = components['schemas']['EstimateLineInput'];
export type EstimateSettingsPatch = components['schemas']['UpdateEstimateRequest'];
export type NewCostItem = components['schemas']['CreateCostItemRequest'];
export type NewCostRate = components['schemas']['CostRateInput'];

const ITEMS = '/v1/orgs/{orgId}/cost-items' as const;
const ITEM = `${ITEMS}/{costItemId}` as const;
const EST = '/v1/orgs/{orgId}/projects/{projectId}/estimates' as const;
const ONE = `${EST}/{estimateId}` as const;
const LINES = `${ONE}/lines` as const;
const LINE = `${LINES}/{lineId}` as const;

const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createEstimatesApi(orgId: string) {
  return {
    /** The whole library, or what matches a search, in code order. */
    listCostItems: (opts: { q?: string; region?: string } = {}): Promise<CostItem[]> =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET(ITEMS, {
            params: {
              path: { orgId },
              query: {
                limit: 100,
                ...(opts.q ? { q: opts.q } : {}),
                ...(opts.region ? { region: opts.region } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
          }),
        ),
      ),

    async createCostItem(input: NewCostItem): Promise<CostItem> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(ITEMS, {
          params: { path: { orgId }, header: idempotencyKey() },
          body: input,
        }),
      );
    },

    async addCostRate(costItemId: string, input: NewCostRate): Promise<void> {
      await ensureCsrfToken();
      unwrap(
        await api.POST(`${ITEM}/rates`, { params: { path: { orgId, costItemId } }, body: input }),
      );
    },

    async listCostRates(costItemId: string): Promise<CostRate[]> {
      return unwrap(await api.GET(`${ITEM}/rates`, { params: { path: { orgId, costItemId } } }))
        .data;
    },

    async listEstimates(projectId: string): Promise<EstimateSummary[]> {
      return allPages(async (cursor) =>
        unwrap(
          await api.GET(EST, {
            params: {
              path: { orgId, projectId },
              query: { limit: 100, ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      );
    },

    async createEstimate(projectId: string, input: { name: string }): Promise<Estimate> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(EST, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body: { name: input.name.trim() },
        }),
      );
    },

    async getEstimate(projectId: string, estimateId: string): Promise<Estimate> {
      return unwrap(await api.GET(ONE, { params: { path: { orgId, projectId, estimateId } } }));
    },

    async updateEstimate(
      projectId: string,
      estimate: Pick<Estimate, 'id' | 'version'>,
      patch: EstimateSettingsPatch,
    ): Promise<Estimate> {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH(ONE, {
          params: {
            path: { orgId, projectId, estimateId: estimate.id },
            header: ifMatch(estimate.version),
          },
          body: patch,
        }),
      );
    },

    async addLine(
      projectId: string,
      estimateId: string,
      input: EstimateLineInput,
    ): Promise<Estimate> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(LINES, { params: { path: { orgId, projectId, estimateId } }, body: input }),
      );
    },

    async updateLine(
      projectId: string,
      estimateId: string,
      lineId: string,
      patch: EstimateLineInput,
    ): Promise<Estimate> {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH(LINE, {
          params: { path: { orgId, projectId, estimateId, lineId } },
          body: patch,
        }),
      );
    },

    async deleteLine(projectId: string, estimateId: string, lineId: string): Promise<Estimate> {
      await ensureCsrfToken();
      return unwrap(
        await api.DELETE(LINE, { params: { path: { orgId, projectId, estimateId, lineId } } }),
      );
    },

    async issue(projectId: string, estimate: Pick<Estimate, 'id' | 'version'>): Promise<Estimate> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${ONE}/issue`, {
          params: {
            path: { orgId, projectId, estimateId: estimate.id },
            header: ifMatch(estimate.version),
          },
        }),
      );
    },
  };
}

export type EstimatesApi = ReturnType<typeof createEstimatesApi>;

/**
 * Takeoff to estimate lines (EST-US11): one line per tag and unit from accepted measurements. A measurement already on
 * a line of this estimate is left out, so sending twice never counts a quantity twice.
 */
export function groupForEstimate(
  measurements: ReadonlyArray<{ id: string; label: string; unit: string }>,
  estimate: Pick<Estimate, 'lines'>,
): Array<{ description: string; measurementIds: string[] }> {
  const linked = new Set(estimate.lines.flatMap((l) => l.measurementIds));
  const groups = new Map<string, { description: string; measurementIds: string[] }>();
  for (const m of measurements) {
    if (linked.has(m.id)) continue;
    const key = `${m.label}\u0000${m.unit}`;
    const g = groups.get(key) ?? { description: m.label, measurementIds: [] };
    g.measurementIds.push(m.id);
    groups.set(key, g);
  }
  return [...groups.values()];
}
