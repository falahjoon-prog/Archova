// Synthetic project location tree (`platform.project_locations`: building › level › area), shared by defects,
// diary lines and photos in the preview.

export interface MockLocation {
  id: string;
  /** "Building A › Ground › Lobby". */
  path: string;
  level: string;
}

const tree: Array<[string, string, string[]]> = [
  ['Building A', 'Ground', ['Lobby', 'Retail 1', 'Retail 2', 'Bin store', 'Amenities']],
  ['Building A', 'Level 1', ['Unit 101', 'Unit 102', 'Corridor']],
  ['Building A', 'Level 2', ['Unit 201', 'Unit 202', 'Corridor']],
  ['Building A', 'Roof', ['Plant deck']],
];

export const MOCK_LOCATIONS: readonly MockLocation[] = tree.flatMap(([building, level, areas]) =>
  areas.map((area) => ({
    id: `loc_${level}_${area}`.toLowerCase().replace(/\s+/g, '_'),
    path: `${building} › ${level} › ${area}`,
    level,
  })),
);

export const MOCK_LEVELS = [...new Set(MOCK_LOCATIONS.map((l) => l.level))];

export function locationPath(id: string | null | undefined): string | null {
  return MOCK_LOCATIONS.find((l) => l.id === id)?.path ?? null;
}

export function locationLevel(id: string | null | undefined): string | null {
  return MOCK_LOCATIONS.find((l) => l.id === id)?.level ?? null;
}
