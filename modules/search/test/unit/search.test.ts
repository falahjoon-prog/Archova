import { describe, expect, it, vi } from 'vitest';
import type { TenantScope } from '@archova/kernel';
import { cleanQuery, createSearchService, type SearchDeps } from '../../src/application/search';

const scope = {} as TenantScope;
const P1 = '018f0000-0000-7000-8000-000000000001';
const P2 = '018f0000-0000-7000-8000-000000000002';

const source = (hitsByProject: Record<string, number>) => ({
  searchHits: vi.fn(async (_s: TenantScope, projectId: string, _q: string, limit: number) => ({
    restricted: false,
    hits: Array.from({ length: Math.min(hitsByProject[projectId] ?? 0, limit) }, (_, i) => ({
      id: `018f0000-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`,
      ref: `X-${i}`,
      title: `Hit ${i}`,
      status: 'open',
    })),
  })),
});

function deps(overrides: Partial<SearchDeps['sources']> = {}): SearchDeps {
  const none = source({});
  return {
    platform: {
      listProjects: vi.fn(async () => ({
        data: [
          { id: P1, name: 'Alpha', status: 'active' },
          { id: P2, name: 'Beta', status: 'active' },
          { id: '018f0000-0000-7000-8000-000000000003', name: 'Old', status: 'archived' },
        ],
        nextCursor: null,
      })),
    } as unknown as SearchDeps['platform'],
    sources: {
      rfi: none,
      document: none,
      defect: none,
      submittal: none,
      correspondence: none,
      ...overrides,
    },
  };
}

describe('cleanQuery', () => {
  it('collapses spaces and caps the length', () => {
    expect(cleanQuery('  fire   door ')).toBe('fire door');
    expect(cleanQuery('a'.repeat(300))).toHaveLength(100);
  });
});

describe('search', () => {
  it('returns nothing for a one-character query without asking any tool', async () => {
    const rfi = source({ [P1]: 3 });
    const out = await createSearchService(deps({ rfi })).search(scope, { q: ' a ', perType: 8 });
    expect(out.results).toEqual([]);
    expect(rfi.searchHits).not.toHaveBeenCalled();
  });

  it('skips archived projects and tags each hit with its project', async () => {
    const rfi = source({ [P1]: 1 });
    const out = await createSearchService(deps({ rfi })).search(scope, { q: 'door', perType: 8 });
    expect(rfi.searchHits).toHaveBeenCalledTimes(2);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ type: 'rfi', projectName: 'Alpha', ref: 'X-0' });
    expect(out.results[0]!.id.startsWith('rfi_')).toBe(true);
    expect(out.truncated).toBe(false);
  });

  it('keeps at most perType rows of a type across projects and says so', async () => {
    const defect = source({ [P1]: 2, [P2]: 5 });
    const out = await createSearchService(deps({ defect })).search(scope, {
      q: 'crack',
      perType: 3,
    });
    expect(out.results.filter((r) => r.type === 'defect')).toHaveLength(3);
    expect(defect.searchHits).toHaveBeenLastCalledWith(scope, P2, 'crack', 1);
    expect(out.truncated).toBe(true);
  });
});
