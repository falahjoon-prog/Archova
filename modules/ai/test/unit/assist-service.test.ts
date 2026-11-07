import { describe, expect, it, vi } from 'vitest';
import { AppError, type Database, type Logger, type TenantContext } from '@archova/kernel';
import { createAssistService } from '../../src/application/assist';
import type { NovaTool } from '../../src/domain/assist';

const ctx = { orgId: 'org-1', userId: 'user-1' } as unknown as TenantContext;

function build(tools: NovaTool[]) {
  const warn = vi.fn();
  const database = {
    withTenantTx: async (_ctx: TenantContext, fn: (scope: unknown) => unknown) => fn({}),
  } as unknown as Database;
  // The planner asks for every tool once, then has nothing more to ask.
  const runTask = vi
    .fn()
    .mockResolvedValueOnce({
      status: 'ok',
      output: { calls: tools.map((t) => ({ tool: t.name, args: {} })) },
    })
    .mockResolvedValue({ status: 'ok', output: { calls: [] } });
  const service = createAssistService({
    database,
    logger: { warn } as unknown as Logger,
    gateway: { runTask } as never,
    assert: async () => {},
    tools,
    search: { search: async () => [] },
  });
  return { service, warn };
}

const failing = (name: string, error: Error): NovaTool => ({
  name,
  description: name,
  params: {},
  run: async () => {
    throw error;
  },
});

describe('a tool that fails while Nova looks something up', () => {
  it('shows the person "could not look up" and logs which tool and why, without arguments or record text', async () => {
    const { service, warn } = build([
      failing('budget_findings', new AppError('access.denied', 'Secret subject RFI-014')),
      failing('open_defects', new Error('relation "defects" failed on row 42: grout missing')),
    ]);
    const a = await service.ask(
      ctx,
      'project-1',
      { question: 'How are we going?', context: {}, history: [] },
      undefined,
    );
    expect(a.found).toBe(false);
    expect(a.lookups).toEqual([
      { tool: 'budget_findings', summary: 'could not look up' },
      { tool: 'open_defects', summary: 'could not look up' },
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      { tool: 'budget_findings', orgId: 'org-1', code: 'access.denied' },
      'nova tool failed',
    );
    expect(warn).toHaveBeenCalledWith(
      { tool: 'open_defects', orgId: 'org-1', code: 'unexpected' },
      'nova tool failed',
    );
    // Nothing a person wrote reaches the log line.
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Secret subject|grout/);
  });

  it('does not log a lookup that worked', async () => {
    const ok: NovaTool = {
      name: 'overdue_rfis',
      description: 'x',
      params: {},
      run: async () => [],
    };
    const { service, warn } = build([ok]);
    await service.ask(ctx, 'project-1', { question: 'Anything late?', context: {}, history: [] });
    expect(warn).not.toHaveBeenCalled();
  });
});
