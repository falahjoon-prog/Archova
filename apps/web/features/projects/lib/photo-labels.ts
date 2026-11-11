// Words for the project photo library's trades and date filter. The trade ids are the defect trades Nova uses; an id
// not listed here is shown as plain words, so a new trade never breaks the filter.
const TRADES: Record<string, string> = {
  concrete: 'Concrete',
  formwork: 'Formwork',
  reinforcement: 'Reinforcement and steel fixing',
  structural_steel: 'Structural steel',
  masonry: 'Bricklaying and blockwork',
  carpentry: 'Carpentry and framing',
  roofing: 'Roofing',
  cladding: 'Cladding and facade',
  glazing: 'Windows and glazing',
  waterproofing: 'Waterproofing',
  plastering: 'Plastering and render',
  plasterboard: 'Plasterboard and ceilings',
  painting: 'Painting',
  tiling: 'Tiling',
  flooring: 'Flooring',
  joinery: 'Joinery and cabinetry',
  doors: 'Doors and hardware',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  mechanical: 'Mechanical and air conditioning',
  fire_services: 'Fire services',
  lifts: 'Lifts',
  landscaping: 'Landscaping',
  civil: 'Civil and drainage',
  cleaning: 'Cleaning',
};

export const PHOTO_TRADE_OPTIONS = Object.entries(TRADES).map(([value, label]) => ({
  value,
  label,
}));

export function tradeLabel(id: string): string {
  if (TRADES[id]) return TRADES[id];
  const words = id.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const PHOTO_AGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
] as const;

/** "slab, formwork" -> ['slab', 'formwork']; the API lowercases, trims and caps them. */
export const parseTags = (text: string): string[] =>
  text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
