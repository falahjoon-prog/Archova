'use client';

import { useCallback, useMemo, useReducer } from 'react';
import type { Point, TakeoffGeometry } from '@archova/markup';

/** Tools of the measure panel (EST-AC9), plus two-point calibration for the scale. */
export type TakeoffTool = 'length' | 'area' | 'count' | 'calibrate';

export interface ToolState {
  tool: TakeoffTool | null;
  /** Points of the shape being drawn (polyline, polygon ring, count markers or calibration line). */
  points: Point[];
  /** For area: the closed outer ring once the user starts adding cut-outs. */
  outer: Point[] | null;
  holes: Point[][];
}

type Action =
  | { type: 'pick'; tool: TakeoffTool | null }
  | { type: 'add'; point: Point }
  | { type: 'undo' }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'close-ring' }
  | { type: 'reset' };

const empty = (tool: TakeoffTool | null): ToolState => ({
  tool,
  points: [],
  outer: null,
  holes: [],
});

export function toolReducer(state: ToolState, action: Action): ToolState {
  switch (action.type) {
    case 'pick':
      return empty(action.tool);
    case 'reset':
      return empty(state.tool);
    case 'add':
      if (state.tool === 'calibrate' && state.points.length >= 2)
        return { ...state, points: [action.point] };
      return { ...state, points: [...state.points, action.point] };
    case 'undo':
      if (state.points.length) return { ...state, points: state.points.slice(0, -1) };
      // Undo past an empty cut-out reopens the last ring.
      if (state.holes.length)
        return {
          ...state,
          points: state.holes[state.holes.length - 1]!,
          holes: state.holes.slice(0, -1),
        };
      if (state.outer) return { ...state, points: state.outer, outer: null };
      return state;
    case 'nudge': {
      const last = state.points[state.points.length - 1];
      if (!last) return state;
      const moved = {
        x: Math.min(1, Math.max(0, last.x + action.dx)),
        y: Math.min(1, Math.max(0, last.y + action.dy)),
      };
      return { ...state, points: [...state.points.slice(0, -1), moved] };
    }
    case 'close-ring':
      // Area only: the first closed ring is the outline, later ones are deductions.
      if (state.tool !== 'area' || state.points.length < 3) return state;
      return state.outer
        ? { ...state, holes: [...state.holes, state.points], points: [] }
        : { ...state, outer: state.points, points: [] };
  }
}

/** The geometry the current state would save, or null if it isn't a complete shape yet. */
export function geometryOf(state: ToolState): TakeoffGeometry | null {
  switch (state.tool) {
    case 'length':
      return state.points.length >= 2 ? { kind: 'length', points: state.points } : null;
    case 'count':
      return state.points.length >= 1 ? { kind: 'count', points: state.points } : null;
    case 'area': {
      if (state.outer) {
        const holes = state.points.length >= 3 ? [...state.holes, state.points] : state.holes;
        return { kind: 'area', outer: state.outer, holes };
      }
      return state.points.length >= 3 ? { kind: 'area', outer: state.points, holes: [] } : null;
    }
    default:
      return null;
  }
}

export function useTakeoffTool() {
  const [state, dispatch] = useReducer(toolReducer, empty(null));
  const actions = useMemo(
    () => ({
      pick: (tool: TakeoffTool | null) => dispatch({ type: 'pick', tool }),
      add: (point: Point) => dispatch({ type: 'add', point }),
      undo: () => dispatch({ type: 'undo' }),
      nudge: (dx: number, dy: number) => dispatch({ type: 'nudge', dx, dy }),
      closeRing: () => dispatch({ type: 'close-ring' }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [],
  );
  const geometry = useCallback(() => geometryOf(state), [state]);
  return { state, actions, geometry };
}
