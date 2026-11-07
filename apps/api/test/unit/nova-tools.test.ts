// Nova's toolbox (ai/07 §3): every tool the modules register has to keep to the same rules, so a tool added later
// fails here until it does. The module APIs are stubbed as denying the caller; the integration test
// `nova-tools-access.test.ts` runs the same list against the real modules and real callers.
import { describe, expect, it } from 'vitest';
import { AssistToolSpec, MAX_ASSIST_TOOLS } from '@archova/ai-prompts';
import { buildNovaTools, type NovaToolSources } from '@archova/compose';
import { encodeId, uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';

const scope = {} as TenantScope;
const projectId = uuidv7();
const rfiId = encodeId('rfi', uuidv7());

/** Every module API a tool reads, answering as it does to someone with no access. A new source needs a line here. */
function denying(limits: number[] = []): NovaToolSources {
  const none = async (_s: TenantScope, _p: string, o: { limit: number }) => {
    limits.push(o.limit);
    return { rows: [], truncated: false, restricted: true };
  };
  return {
    rfis: { overdueForMeeting: none, summariesByIds: async () => [] },
    defects: { openForMeeting: none },
    financials: {
      budgetReviewFacts: async () => {
        throw new AppError('access.denied', 'No access to the budget.');
      },
    },
    scheduling: () => ({
      slipSignals: async () => ({ restricted: true, hasProgramme: false, lateCount: 0, worst: [] }),
    }),
  };
}

/** Arguments that make each tool do its lookup; a tool with no entry here has no denial case yet. */
const DENIAL_ARGS: Record<string, Record<string, string>> = {
  overdue_rfis: {},
  rfi_details: { id: rfiId },
  open_defects: {},
  late_programme_tasks: {},
  budget_findings: {},
};

describe('the Nova toolbox', () => {
  const tools = buildNovaTools(denying());

  it('lists tools the planner can be shown: unique names in the allowed shape, short descriptions', () => {
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.length).toBeLessThanOrEqual(MAX_ASSIST_TOOLS - 1);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of tools) {
      const spec = AssistToolSpec.safeParse({
        name: t.name,
        description: t.description,
        params: t.params,
      });
      expect(spec.success, `${t.name}: ${spec.error?.message}`).toBe(true);
    }
    // `search_records` is built into the ai module, so no module may take its name.
    expect(names).not.toContain('search_records');
  });

  it('has a denial case for every tool, so a new tool cannot join without one', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(DENIAL_ARGS).sort());
  });

  it.each(Object.keys(DENIAL_ARGS))(
    '%s says it cannot show the caller anything, and shows nothing else',
    async (name) => {
      const tool = tools.find((t) => t.name === name)!;
      const findings = await tool.run(scope, projectId, DENIAL_ARGS[name]!);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.text).toMatch(/don't have access to|was not found, or you cannot see it/);
      // Only the restricted line: no counts, names, amounts or dates beside it.
      expect(findings[0]!.text).not.toMatch(/\d/);
    },
  );

  it('asks each module for a bounded number of rows', async () => {
    const limits: number[] = [];
    for (const t of buildNovaTools(denying(limits)))
      await t.run(scope, projectId, DENIAL_ARGS[t.name] ?? {});
    expect(limits.length).toBeGreaterThan(0);
    for (const limit of limits) expect(limit).toBeLessThanOrEqual(25);
  });

  it('declines an id that is not an RFI id without asking the module', async () => {
    let asked = false;
    const sources = denying();
    sources.rfis.summariesByIds = async () => {
      asked = true;
      return [];
    };
    const tool = buildNovaTools(sources).find((t) => t.name === 'rfi_details')!;
    expect(await tool.run(scope, projectId, { id: 'defect_nope' })).toEqual([]);
    expect(await tool.run(scope, projectId, {})).toEqual([]);
    expect(asked).toBe(false);
  });

  it('lets an error that is not a denial through instead of hiding it as "no access"', async () => {
    const sources = denying();
    sources.financials.budgetReviewFacts = async () => {
      throw new Error('connection lost');
    };
    const tool = buildNovaTools(sources).find((t) => t.name === 'budget_findings')!;
    await expect(tool.run(scope, projectId, {})).rejects.toThrow('connection lost');
  });
});
