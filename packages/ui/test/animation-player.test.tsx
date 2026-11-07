// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimationPlayer, SceneFrame, type AnimationScene } from '../src';

afterEach(cleanup);

const scenes: AnimationScene[] = [
  {
    id: 's1',
    title: 'Hard hats',
    narration: 'Wear a hard hat at all times.',
    durationMs: 2000,
    elements: [
      {
        id: 'e1',
        kind: 'text',
        x: 10,
        y: 10,
        w: 80,
        h: 20,
        text: 'Hard hats on',
        tone: 'info',
        motion: { preset: 'fade_in', startMs: 500, durationMs: 500 },
      },
    ],
  },
  { id: 's2', title: 'Hi-vis', narration: null, durationMs: 2000, elements: [] },
];

describe('SceneFrame', () => {
  it('hides an element until its start and shows it after', () => {
    const { rerender } = render(<SceneFrame scene={scenes[0]!} t={0} />);
    expect(screen.getByText('Hard hats on').parentElement!.style.opacity).toBe('0');
    rerender(<SceneFrame scene={scenes[0]!} t={1000} />);
    expect(screen.getByText('Hard hats on').parentElement!.style.opacity).toBe('1');
  });
});

describe('AnimationPlayer', () => {
  it('shows captions and reports completion only after the last scene plays to its end', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const onComplete = vi.fn();
    render(<AnimationPlayer title="PPE" scenes={scenes} enforce onComplete={onComplete} />);
    expect(screen.getByText('Wear a hard hat at all times.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip to next scene' })).toHaveProperty(
      'disabled',
      true,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(onComplete).not.toHaveBeenCalled();
    // Step in small acts so React renders between frames, as it does in a browser.
    // 100 ms steps (about 50 renders for two 2 s scenes) keep this fast on a busy CI runner.
    try {
      for (let i = 0; i < 60; i++)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });
      expect(onComplete).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);
});
