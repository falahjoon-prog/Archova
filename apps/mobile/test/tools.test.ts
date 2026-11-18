import { describe, expect, it } from 'vitest';
import { gridColumns, TOOLS } from '../lib/tools';

describe('project tools', () => {
  it('has one tile per tool, each with a label, an icon and a route inside the project', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      expect(tool.label.length).toBeGreaterThan(0);
      expect(tool.icon.length).toBeGreaterThan(0);
      expect(tool.route('prj_1')).toMatch(/^\/project\/prj_1\//);
    }
  });

  it('fits three tiles across on a phone and more on wider screens', () => {
    expect(gridColumns(360)).toBe(3);
    expect(gridColumns(700)).toBe(4);
    expect(gridColumns(1100)).toBe(5);
  });
});
