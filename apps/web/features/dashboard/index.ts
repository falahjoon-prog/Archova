export { DashboardEditor } from './components/DashboardEditor';
export { TileBoard } from './components/TileBoard';
export { registerTile, getTile, listTiles, TILE_CATEGORIES } from './lib/registry';
export type {
  TileCategory,
  TileConfigProps,
  TileContext,
  TileDef,
  TileProps,
  TileSurface,
} from './lib/registry';
export type { Tile } from './lib/layout';
import './tiles';
