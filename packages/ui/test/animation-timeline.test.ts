import { describe, expect, it } from 'vitest';
import { locate, motionAt, sceneStart, totalMs } from '../src/patterns/animation/timeline';

describe('motionAt', () => {
  it('draws everything straight away for no motion', () => {
    expect(motionAt({ preset: 'none', startMs: 500, durationMs: 400 }, 0)).toEqual({
      opacity: 1,
      tx: 0,
      ty: 0,
      scale: 1,
      draw: 1,
    });
  });
  it('keeps an element hidden until its start and fully shown after it', () => {
    const m = { preset: 'fade_in', startMs: 1000, durationMs: 500 } as const;
    expect(motionAt(m, 999).opacity).toBe(0);
    expect(motionAt(m, 1500).opacity).toBe(1);
    expect(motionAt(m, 1250).opacity).toBeGreaterThan(0);
  });
  it('slides into place and grows to full size', () => {
    expect(motionAt({ preset: 'slide_up', startMs: 0, durationMs: 100 }, 0).ty).toBe(40);
    expect(motionAt({ preset: 'slide_up', startMs: 0, durationMs: 100 }, 100).ty).toBe(0);
    expect(motionAt({ preset: 'pop', startMs: 0, durationMs: 100 }, 100).scale).toBe(1);
  });
  it('draws a line on in proportion and pulses after it appears', () => {
    expect(motionAt({ preset: 'draw_on', startMs: 0, durationMs: 100 }, 100).draw).toBe(1);
    expect(motionAt({ preset: 'draw_on', startMs: 100, durationMs: 100 }, 0).opacity).toBe(0);
    const pulse = { preset: 'pulse', startMs: 0, durationMs: 100 } as const;
    expect(motionAt(pulse, 250).scale).toBeGreaterThan(1);
    expect(motionAt(pulse, 750).scale).toBeLessThan(1);
  });
});

describe('scene positions', () => {
  const scenes = [{ durationMs: 3000 }, { durationMs: 5000 }];
  it('adds up and finds the scene', () => {
    expect(totalMs(scenes)).toBe(8000);
    expect(sceneStart(scenes, 1)).toBe(3000);
    expect(locate(scenes, 3500)).toEqual({ scene: 1, t: 500 });
    expect(locate(scenes, 99999)).toEqual({ scene: 1, t: 5000 });
  });
});
