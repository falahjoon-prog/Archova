// Takeoff measurements against the estimating module's endpoints (backend 04 §3), with the same interface as the
// preview source so the panel and hooks don't change. The API stores less than the preview does:
//   - the trade tag rides in the label ("Plasterboard and ceilings: Grid 3 partition");
//   - the scale a measurement used is the sheet revision's confirmed scale, read from the geometry endpoint;
//   - who measured it is `confirmedBy` (a hand-drawn measurement is confirmed by its author when it is saved);
//   - a measurement sent to a package keeps the package and the scope line it became.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import {
  UNIT_FOR_KIND,
  formatScale,
  parseScale,
  roundQuantity,
  takeoffQuantity,
  type Point,
  type TakeoffGeometry,
  type TakeoffUnit,
} from '@archova/markup';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { projectMembers } from '@/shared/lib/people';
import { TRADES, type NovaFound, type TakeoffMeasurement } from '../lib/takeoff-types';
import type { TakeoffSource } from './takeoff-source';

type ApiMeasurement = components['schemas']['TakeoffMeasurement'];
type ApiGeometry = components['schemas']['TakeoffGeometry'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/takeoff-measurements' as const;
const PKG = '/v1/orgs/{orgId}/projects/{projectId}/tender-packages/{packageId}' as const;
const GEOMETRY =
  '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/geometry';
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

const pairs = (points: readonly Point[]) => points.map((p) => [p.x, p.y]);
const points = (pairs: readonly (readonly number[])[]): Point[] =>
  pairs.map(([x = 0, y = 0]) => ({ x, y }));

export function toApiGeometry(g: TakeoffGeometry): ApiGeometry {
  if (g.kind === 'length') return { type: 'polyline', points: pairs(g.points) };
  if (g.kind === 'count') return { type: 'points', points: pairs(g.points) };
  return {
    type: 'polygon',
    points: pairs(g.outer),
    ...(g.holes.length ? { holes: g.holes.map(pairs) } : {}),
  };
}

export function fromApiGeometry(kind: ApiMeasurement['kind'], g: ApiGeometry): TakeoffGeometry {
  if (kind === 'length') return { kind, points: points(g.points) };
  if (kind === 'count') return { kind, points: points(g.points) };
  return { kind, outer: points(g.points), holes: (g.holes ?? []).map(points) };
}

/** The tag typed in the panel is "Trade: label" in the API; split it again when the prefix is a known trade. */
export function splitTag(stored: string): { trade: string; label: string } {
  const trade = TRADES.find((t) => stored.startsWith(`${t}: `));
  return trade ? { trade, label: stored.slice(trade.length + 2) } : { trade: '', label: stored };
}
const joinTag = (trade: string, label: string) => (trade ? `${trade}: ${label}` : label);

/** Decimal string the API accepts: whole numbers for counts, three places otherwise. */
const decimal = (n: number, unit: TakeoffUnit) =>
  unit === 'ea' ? String(Math.round(n)) : n.toFixed(3);

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);

const UNIT_LABEL: Record<TakeoffUnit, string> = { ea: 'ea', m: 'm', m2: 'm²' };

export function createTakeoffApi(orgId: string): TakeoffSource {
  const scaleOf = async (projectId: string, revisionId: string) => {
    try {
      const g = unwrap(
        await api.GET(GEOMETRY, {
          params: { path: { orgId, projectId, drawingRevisionId: revisionId } },
        }),
      );
      const n = g.scaleConfirmed ?? g.scaleDetected;
      return { scale: n ? formatScale(n) : '', confirmed: g.scaleConfirmed !== null };
    } catch {
      return { scale: '', confirmed: false };
    }
  };

  const toMeasurement = (
    m: ApiMeasurement,
    scale: { scale: string; confirmed: boolean },
    names: ReadonlyMap<string, string>,
  ): TakeoffMeasurement => {
    const tag = splitTag(m.label);
    return {
      id: m.id,
      revisionId: m.revisionId,
      sheetNo: '',
      kind: m.kind,
      geometry: fromApiGeometry(m.kind, m.geometry),
      quantity: Number(m.quantity),
      unit: m.unit as TakeoffUnit,
      scaleUsed: scale.scale,
      scaleConfirmed: scale.confirmed,
      source: m.source,
      confidence: m.confidence,
      confirmed: Boolean(m.confirmedAt),
      rejected: Boolean(m.rejectedAt),
      raster: false,
      label: tag.label,
      trade: tag.trade,
      packageId: m.packageId,
      supersededByRevisionId: null,
      createdBy:
        (m.confirmedBy && names.get(m.confirmedBy)) ||
        (m.source === 'manual' ? 'Project member' : 'Nova'),
      createdAt: m.createdAt,
    };
  };

  const names = async (projectId: string) =>
    new Map((await projectMembers(orgId, projectId)).map((p) => [p.id, p.name]));

  const get = async (projectId: string, measurementId: string) =>
    unwrap(
      await api.GET(`${P}/{measurementId}`, {
        params: { path: { orgId, projectId, measurementId } },
      }),
    );

  return {
    async list(projectId, filter) {
      const [people, perRevision] = await Promise.all([
        names(projectId),
        Promise.all(
          filter.revisionIds.map(async (revisionId) => {
            const [rows, scale] = await Promise.all([
              allPages(async (cursor) =>
                unwrap(
                  await api.GET(P, {
                    params: {
                      path: { orgId, projectId },
                      query: { revisionId, limit: 200, cursor },
                    },
                  }),
                ),
              ),
              scaleOf(projectId, revisionId),
            ]);
            return { rows, scale };
          }),
        ),
      ]);
      return perRevision.flatMap(({ rows, scale }) =>
        // The API lists newest first; the panel reads oldest first like the preview store.
        [...rows].reverse().map((m) => toMeasurement(m, scale, people)),
      );
    },

    async createMany(projectId, input) {
      const ratio = parseScale(input.scale);
      await ensureCsrfToken();
      const created: TakeoffMeasurement[] = [];
      const people = await names(projectId);
      for (const item of input.items) {
        const unit = UNIT_FOR_KIND[item.geometry.kind];
        const quantity = ratio
          ? roundQuantity(takeoffQuantity(item.geometry, input.size, ratio), unit)
          : 0;
        const row = unwrap(
          await api.POST(P, {
            params: {
              path: { orgId, projectId },
              header: { 'Idempotency-Key': crypto.randomUUID() },
            },
            body: {
              revisionId: item.revisionId,
              label: joinTag(item.trade, item.label),
              kind: item.geometry.kind,
              geometry: toApiGeometry(item.geometry),
              quantity: decimal(quantity, unit),
              unit,
              source: 'manual',
            },
          }),
        );
        created.push(
          toMeasurement(row, { scale: input.scale, confirmed: input.scaleConfirmed }, people),
        );
      }
      return created;
    },

    /** Nova finds the marks; the quantity is worked out here from the geometry and the confirmed scale, never by Nova. */
    async findWithNova(projectId, input): Promise<NovaFound> {
      const ratio = parseScale(input.scale);
      if (!ratio) throw new Error('Set the sheet scale before asking Nova to measure.');
      await ensureCsrfToken();
      const found = unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/takeoff-detections', {
          params: { path: { orgId, projectId } },
          body: {
            revisionId: input.revisionId,
            target: { kind: input.kind, what: input.what },
            ...(input.image ? { image: input.image } : {}),
          },
        }),
      );
      const base = { caveat: found.caveat, dropped: found.dropped, scanned: found.scanned };
      if (!found.items.length) return { marks: [], ...base };
      const unit = UNIT_FOR_KIND[input.kind];
      const items = found.items.map((item) => {
        const geometry: TakeoffGeometry =
          input.kind === 'area'
            ? { kind: 'area', outer: item.points, holes: [] }
            : { kind: input.kind, points: item.points };
        return {
          label: joinTag(input.trade, item.place ? `${input.what} · ${item.place}` : input.what),
          kind: input.kind,
          geometry: toApiGeometry(geometry),
          quantity: decimal(
            input.kind === 'count'
              ? 1
              : roundQuantity(takeoffQuantity(geometry, input.size, ratio), unit),
            unit,
          ),
          unit,
          confidence: item.confidence,
        };
      });
      const saved = unwrap(
        await api.POST(`${P}/batch`, {
          params: { path: { orgId, projectId } },
          body: { revisionId: input.revisionId, items },
        }),
      );
      const people = await names(projectId);
      const scale = { scale: input.scale, confirmed: input.scaleConfirmed };
      return { marks: saved.data.map((m) => toMeasurement(m, scale, people)), ...base };
    },

    async accept(projectId, measurementId) {
      await ensureCsrfToken();
      const current = await get(projectId, measurementId);
      const row = unwrap(
        await api.POST(`${P}/{measurementId}/confirm`, {
          params: { path: { orgId, projectId, measurementId }, header: ifMatch(current.version) },
        }),
      );
      return toMeasurement(row, await scaleOf(projectId, row.revisionId), await names(projectId));
    },

    async reject(projectId, measurementId) {
      await ensureCsrfToken();
      const current = await get(projectId, measurementId);
      const row = unwrap(
        await api.POST(`${P}/{measurementId}/reject`, {
          params: { path: { orgId, projectId, measurementId }, header: ifMatch(current.version) },
        }),
      );
      return toMeasurement(row, await scaleOf(projectId, row.revisionId), await names(projectId));
    },

    async acceptAbove(projectId, revisionId, minConfidence) {
      await ensureCsrfToken();
      const done = unwrap(
        await api.POST(`${P}/confirm-batch`, {
          params: { path: { orgId, projectId } },
          body: { revisionId, minConfidence },
        }),
      );
      return done.data.length;
    },

    async update(projectId, measurementId, patch) {
      await ensureCsrfToken();
      const current = await get(projectId, measurementId);
      const tag = splitTag(current.label);
      const label = patch.label ?? tag.label;
      const trade = patch.trade ?? tag.trade;
      const row = unwrap(
        await api.PATCH(`${P}/{measurementId}`, {
          params: { path: { orgId, projectId, measurementId }, header: ifMatch(current.version) },
          body: {
            ...(patch.label !== undefined || patch.trade !== undefined
              ? { label: joinTag(trade, label) }
              : {}),
            ...(patch.packageId !== undefined ? { packageId: patch.packageId } : {}),
          },
        }),
      );
      return toMeasurement(row, await scaleOf(projectId, row.revisionId), await names(projectId));
    },

    async remove(projectId, measurementId) {
      await ensureCsrfToken();
      unwrap(
        await api.DELETE(`${P}/{measurementId}`, {
          params: { path: { orgId, projectId, measurementId } },
        }),
      );
    },

    /** One scope line per tag and unit; a second send for the same tag adds to the line it made before (EST-US8). */
    async sendToPackage(projectId, ids, packageId) {
      await ensureCsrfToken();
      const rows = await Promise.all(ids.map((id) => get(projectId, id)));
      const groups = new Map<
        string,
        { key: string; tag: string; unit: TakeoffUnit; quantity: number; rows: ApiMeasurement[] }
      >();
      for (const row of rows) {
        const unit = row.unit as TakeoffUnit;
        const tag = row.label;
        const key = `tk_${slug(tag) || 'untagged'}_${unit}`;
        const g = groups.get(key) ?? { key, tag, unit, quantity: 0, rows: [] };
        g.quantity += Number(row.quantity);
        g.rows.push(row);
        groups.set(key, g);
      }
      const pkg = unwrap(await api.GET(PKG, { params: { path: { orgId, projectId, packageId } } }));
      const scope = pkg.scope.map((s) => ({ ...s }));
      for (const g of groups.values()) {
        const existing = scope.find((s) => s.key === g.key);
        const total = roundQuantity(g.quantity + Number(existing?.quantity ?? 0), g.unit);
        if (existing) existing.quantity = decimal(total, g.unit);
        else
          scope.push({
            key: g.key,
            description: g.tag,
            quantity: decimal(total, g.unit),
            unit: UNIT_LABEL[g.unit],
            source: 'takeoff',
          });
      }
      unwrap(
        await api.PATCH(PKG, {
          params: { path: { orgId, projectId, packageId }, header: ifMatch(pkg.version) },
          body: { scope },
        }),
      );
      for (const g of groups.values()) {
        for (const row of g.rows) {
          unwrap(
            await api.PATCH(`${P}/{measurementId}`, {
              params: {
                path: { orgId, projectId, measurementId: row.id },
                header: ifMatch(row.version),
              },
              body: { packageId, scopeKey: g.key },
            }),
          );
        }
      }
      return rows.length;
    },
  };
}
