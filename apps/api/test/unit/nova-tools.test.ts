import { buildNovaTools, type NovaToolSources } from '@archova/compose';
import { MAX_FINDING_CHARS } from '@archova/mod-ai';
import { AppError, type TenantScope } from '@archova/kernel';
import { describe, expect, it } from 'vitest';

// Sam's review of the Nova tool registry (#470): every tool must be shown to refuse a caller who may not see its data,
// and every tool must have a safe shape. Both tests iterate the registry, so a tool added later is covered without
// anyone remembering to add a case. Adding a tool that reads a new module method also fails to compile here until
// that method gets a denied stub below, which is the point.

const scope = {} as TenantScope;
const PROJECT = 'prj_00000000000000000000000000';

/** Every source answers as it does for a caller without the module's permission. */
const denied: NovaToolSources = {
  rfis: {
    overdueForMeeting: async () => ({ rows: [], truncated: false, restricted: true }),
    summariesByIds: async () => [],
  },
  defects: {
    openForMeeting: async () => ({ rows: [], truncated: false, restricted: true }),
  },
  financials: {
    budgetReviewFacts: async () => {
      throw new AppError('access.denied');
    },
  },
  scheduling: () => ({
    slipSignals: async () => ({ restricted: true, hasProgramme: false, lateCount: 0, worst: [] }),
  }),
};

/** A syntactically valid id for every id-shaped argument, so a tool is exercised rather than skipped. */
const argsFor = (params: Record<string, string>) =>
  Object.fromEntries(Object.keys(params).map((k) => [k, 'rfi_00000000000000000000000000']));

describe('Nova tool registry', () => {
  const tools = buildNovaTools(denied);

  it('has at least one tool and no duplicate names', () => {
    expect(tools.length).toBeGreaterThan(0);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
  });

  it('gives every tool a name, description and parameters the planner prompt can carry safely', () => {
    for (const t of tools) {
      expect(t.name, t.name).toMatch(/^[a-z][a-z0-9_]{2,40}$/);
      expect(t.description.length, t.name).toBeGreaterThan(10);
      expect(t.description.length, t.name).toBeLessThanOrEqual(300);
      for (const [k, v] of Object.entries(t.params)) {
        expect(k, `${t.name} param`).toMatch(/^[a-z][A-Za-z0-9]{0,30}$/);
        expect(v.length, `${t.name}.${k}`).toBeLessThanOrEqual(300);
      }
    }
  });

  it('returns only a no-access finding, with no record text, to a caller who may not see the module', async () => {
    for (const t of tools) {
      const findings = await t.run(scope, PROJECT, argsFor(t.params));
      for (const f of findings) {
        expect(f.text, `${t.name} must say the caller has no access`).toMatch(
          /don't have access|cannot see/i,
        );
        expect(f.text.length, t.name).toBeLessThanOrEqual(MAX_FINDING_CHARS);
      }
    }
  });
});
