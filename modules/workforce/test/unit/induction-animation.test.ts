import { describe, expect, it } from 'vitest';
import { fromContentDto, toContentDto } from '../../src/api/induction-mappers';
import { contentProblems } from '../../src/domain/induction';

import type { InductionAnimationScene } from '../../src/domain/induction';

const scene: InductionAnimationScene = {
  id: 'sc1',
  template: 'hazard_callout',
  title: 'Overhead cranes',
  narration: 'Keep clear of loads.',
  durationMs: 6000,
  elements: [
    {
      id: 'e1',
      kind: 'icon',
      x: 10,
      y: 10,
      w: 20,
      h: 30,
      icon: 'hazard',
      tone: 'warning',
      motion: { preset: 'pop', startMs: 0, durationMs: 500 },
    },
  ],
};

describe('animation blocks', () => {
  it('pass through the content mappers unchanged', () => {
    const dto = {
      passMark: 80,
      quiz: [],
      sections: [
        {
          key: 'site_hazards' as const,
          title: 'Site hazards',
          blocks: [{ type: 'animation' as const, title: 'Cranes', scenes: [scene] }],
        },
      ],
    };
    const internal = fromContentDto(dto as never);
    expect(internal.sections[0]!.blocks[0]).toEqual(dto.sections[0]!.blocks[0]);
    expect(toContentDto(internal).sections[0]!.blocks[0]).toEqual(dto.sections[0]!.blocks[0]);
  });

  it('count as content for the section they are in', () => {
    const problems = contentProblems({
      passMark: 80,
      quiz: [],
      sections: [
        {
          key: 'site_hazards',
          title: 'Site hazards',
          blocks: [{ type: 'animation', title: null, scenes: [scene] }],
        },
      ],
    });
    expect(problems.some((p) => p.path === 'sections/site_hazards')).toBe(false);
  });
});
