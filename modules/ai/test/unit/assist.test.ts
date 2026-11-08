import { describe, expect, it } from 'vitest';
import {
  MAX_TOTAL_CALLS,
  acceptCalls,
  findingPassages,
  toolSpecs,
  type NovaTool,
} from '../../src/domain/assist';

const tool = (name: string, params: Record<string, string> = {}): NovaTool => ({
  name,
  description: name,
  params,
  run: async () => [],
});
const TOOLS = [tool('overdue_rfis'), tool('rfi_details', { id: 'The RFI id.' })];

describe('acceptCalls', () => {
  it('keeps registered tools and drops invented ones', () => {
    const calls = acceptCalls(
      [
        { tool: 'overdue_rfis', args: {} },
        { tool: 'delete_everything', args: {} },
      ],
      TOOLS,
      new Set(),
    );
    expect(calls.map((c) => c.tool.name)).toEqual(['overdue_rfis']);
  });

  it('passes only the arguments a tool names, trimmed and capped', () => {
    const [c] = acceptCalls(
      [{ tool: 'rfi_details', args: { id: `  rfi_X${'a'.repeat(300)}  `, sneaky: 'x' } }],
      TOOLS,
      new Set(),
    );
    expect(Object.keys(c!.args)).toEqual(['id']);
    expect(c!.args.id!.length).toBe(200);
  });

  it('does not repeat a call already made, including within one plan', () => {
    const first = acceptCalls(
      [
        { tool: 'overdue_rfis', args: {} },
        { tool: 'overdue_rfis', args: {} },
      ],
      TOOLS,
      new Set(),
    );
    expect(first).toHaveLength(1);
    const again = acceptCalls(
      [{ tool: 'overdue_rfis', args: {} }],
      TOOLS,
      new Set([first[0]!.key]),
    );
    expect(again).toHaveLength(0);
  });

  it('stops at the budget for one question', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      tool: 'rfi_details',
      args: { id: `rfi_${i}` },
    }));
    const made = new Set(Array.from({ length: MAX_TOTAL_CALLS - 1 }, (_, i) => `x${i}`));
    expect(acceptCalls(many, TOOLS, made)).toHaveLength(1);
  });
});

describe('findingPassages', () => {
  it('numbers passages t1… continuing from the offset and caps long text', () => {
    const ps = findingPassages([{ title: 'A', type: 'rfi', id: 'p', text: 'x'.repeat(9000) }], 2);
    expect(ps[0]!.id).toBe('t3');
    expect(ps[0]!.text.length).toBe(4000);
    expect(ps[0]!.source).toEqual({ type: 'rfi', id: 'p', title: 'A' });
  });
});

describe('toolSpecs', () => {
  it('shows the model names, descriptions and parameters only', () => {
    expect(toolSpecs(TOOLS)[1]).toEqual({
      name: 'rfi_details',
      description: 'rfi_details',
      params: { id: 'The RFI id.' },
    });
  });
});
