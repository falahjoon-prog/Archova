// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { AnimationEditor } from '../components/AnimationEditor';
import {
  TEMPLATE_LABELS,
  animationProblems,
  duplicateScene,
  lastMotionEnd,
  moveItem,
  newAnimationBlock,
  newElement,
  newScene,
  placeElement,
  type AnimationBlock,
  type SceneTemplate,
} from '../lib/animation';
import { contentProblems } from '../lib/content';

afterEach(cleanup);

const templates = Object.keys(TEMPLATE_LABELS) as SceneTemplate[];

describe('scene templates', () => {
  it.each(templates)('%s starts as a valid scene the server will accept', (t) => {
    const s = newScene(t);
    expect(s.title.length).toBeGreaterThan(0);
    expect(s.elements.length).toBeLessThanOrEqual(30);
    expect(new Set(s.elements.map((e) => e.id)).size).toBe(s.elements.length);
    for (const e of s.elements) {
      expect(e.id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
      expect(e.x + e.w).toBeLessThanOrEqual(100);
      expect(e.y + e.h).toBeLessThanOrEqual(100);
      if (e.kind === 'text') expect((e.text ?? '').length).toBeGreaterThan(0);
    }
    expect(lastMotionEnd(s)).toBeLessThanOrEqual(s.durationMs);
    expect(animationProblems({ type: 'animation', title: null, scenes: [s] }, 'S')).toEqual([]);
  });

  it('gives every new scene and element its own ids', () => {
    const a = newScene('ppe_checklist');
    const b = duplicateScene(a);
    expect(b.id).not.toBe(a.id);
    expect(b.title).toBe('PPE (copy)');
    expect(b.elements.map((e) => e.id).some((id) => a.elements.some((x) => x.id === id))).toBe(
      false,
    );
    b.elements[0]!.motion.startMs = 999;
    expect(a.elements[0]!.motion.startMs).not.toBe(999);
  });
});

describe('editing rules', () => {
  it('keeps an element inside the stage', () => {
    const e = newElement('box');
    expect(placeElement(e, { x: 500, y: -4 })).toMatchObject({ x: 100 - e.w, y: 0 });
    expect(placeElement(e, { w: 90, x: 50 })).toMatchObject({ w: 90, x: 10 });
  });

  it('moves list items one step and stops at the ends', () => {
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it('reports a blank title, empty text and a scene shorter than its animations', () => {
    const block = newAnimationBlock('steps');
    const s = block.scenes[0]!;
    s.title = ' ';
    s.elements[0]!.text = '';
    s.durationMs = 2000;
    const problems = animationProblems(block, 'PPE');
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toMatch(/title/);
    expect(problems.join(' ')).toMatch(/empty text/);
    expect(problems.join(' ')).toMatch(/shorter than its animations/);
  });

  it('is checked with the rest of the draft before it saves', () => {
    const block = newAnimationBlock('steps');
    block.scenes[0]!.title = '';
    const problems = contentProblems({
      passMark: 80,
      quiz: [],
      sections: [{ key: 'ppe', title: 'PPE', blocks: [block] }],
    });
    expect(problems).toEqual(['PPE, scene 1 needs a title.']);
  });
});

function Harness({ start }: { start: AnimationBlock }) {
  const [block, setBlock] = useState(start);
  return (
    <>
      <AnimationEditor block={block} onChange={setBlock} />
      <output data-testid="json">{JSON.stringify(block)}</output>
    </>
  );
}
const current = () => JSON.parse(screen.getByTestId('json').textContent!) as AnimationBlock;

describe('AnimationEditor', () => {
  it('adds a scene from a template, renames it and removes it', async () => {
    const user = userEvent.setup();
    render(<Harness start={newAnimationBlock('hazard_callout')} />);
    await user.selectOptions(screen.getByLabelText('Template for a new scene'), 'ppe_checklist');
    await user.click(screen.getByRole('button', { name: 'Add scene' }));
    expect(current().scenes).toHaveLength(2);
    expect(screen.getByRole('tab', { name: '2. PPE', selected: true })).toBeTruthy();
    const title = screen.getByLabelText('Scene title');
    await user.clear(title);
    await user.type(title, 'Gear up');
    expect(current().scenes[1]!.title).toBe('Gear up');
    await user.click(screen.getByRole('button', { name: 'Remove scene' }));
    expect(current().scenes).toHaveLength(1);
  });

  it('never removes the last scene', () => {
    render(<Harness start={newAnimationBlock()} />);
    expect(screen.getByRole('button', { name: 'Remove scene' })).toHaveProperty('disabled', true);
  });

  it('picks an element from the timeline and changes its text, colour and timing', async () => {
    const user = userEvent.setup();
    render(<Harness start={newAnimationBlock('hazard_callout')} />);
    await user.click(screen.getByRole('button', { name: 'Text: Overhead loads' }));
    const text = screen.getByLabelText('Text');
    await user.clear(text);
    await user.type(text, 'Crane lifts');
    await user.selectOptions(screen.getByLabelText('Colour'), 'danger');
    fireEvent.change(screen.getByLabelText('Starts at (ms)'), { target: { value: '1200' } });
    const e = current().scenes[0]!.elements.find((x) => x.text === 'Crane lifts')!;
    expect(e.tone).toBe('danger');
    expect(e.motion.startMs).toBe(1200);
  });

  it('adds and removes elements, and keeps typed positions on the stage', async () => {
    const user = userEvent.setup();
    render(<Harness start={newAnimationBlock('blank')} />);
    await user.click(screen.getByRole('button', { name: 'Add arrow' }));
    expect(current().scenes[0]!.elements).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Left (%)'), { target: { value: '99' } });
    const arrow = current().scenes[0]!.elements[0]!;
    expect(arrow.x + arrow.w).toBeLessThanOrEqual(100);
    await user.click(screen.getByRole('button', { name: 'Remove element' }));
    expect(current().scenes[0]!.elements).toHaveLength(0);
  });

  it('warns when the scene is shorter than its animations', () => {
    const block = newAnimationBlock('steps');
    block.scenes[0]!.durationMs = 2000;
    render(<Harness start={block} />);
    expect(screen.getByRole('alert').textContent).toMatch(/ends before its last animation/);
  });
});
