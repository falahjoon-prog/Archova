import type { ComponentType } from 'react';

/**
 * The tile library. Every dashboard tile is registered here once (`registerTile`) and then shows up in the
 * "Add tiles" panel, in saved layouts and on the board. Charts, health rings, maps and so on register their own tiles
 * from their own feature folder; nothing about a tile is hardcoded on a screen. Import the feature's `tiles` module
 * from the screen so the registration runs.
 */
export type TileCategory =
  | 'project_information'
  | 'cost'
  | 'schedule'
  | 'risk'
  | 'health_status'
  | 'tasks_actions'
  | 'procurements';

export const TILE_CATEGORIES: readonly { id: TileCategory; label: string }[] = [
  { id: 'project_information', label: 'Project information' },
  { id: 'cost', label: 'Cost' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'risk', label: 'Risk' },
  { id: 'health_status', label: 'Health & status' },
  { id: 'tasks_actions', label: 'Tasks & actions' },
  { id: 'procurements', label: 'Procurements' },
];

export type TileSurface = 'portfolio' | 'project';

export interface TileContext {
  surface: TileSurface;
  orgId: string;
  orgSlug: string;
  projectId?: string;
  /** What the surface loaded for its tiles (the Portfolio sets its totals and projects here). Sample data in the library. */
  data?: unknown;
  /** True while a tile is drawn as a library preview: it must render quickly from `ctx.data` and make no requests. */
  preview?: boolean;
}

export interface TileProps {
  config: Record<string, unknown>;
  ctx: TileContext;
  size: { w: number; h: number };
}

export interface TileConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  ctx: TileContext;
}

export interface TileDef {
  /** Stored in saved layouts, so it never changes: lowercase letters, digits and underscores. */
  type: string;
  title: string;
  description: string;
  category: TileCategory;
  surfaces: readonly TileSurface[];
  /** Size in grid cells when added (12 columns). */
  size: { w: number; h: number };
  min?: { w: number; h: number };
  config?: Record<string, unknown>;
  render: ComponentType<TileProps>;
  /** Present when the tile has settings (a text, a metric); shown as a Settings button in edit mode. */
  Settings?: ComponentType<TileConfigProps>;
}

const defs = new Map<string, TileDef>();

export function registerTile(def: TileDef): void {
  defs.set(def.type, def);
}

export const getTile = (type: string): TileDef | undefined => defs.get(type);

export const listTiles = (surface: TileSurface): TileDef[] =>
  [...defs.values()].filter((d) => d.surfaces.includes(surface));
