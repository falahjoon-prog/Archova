// Synthetic project directory shared by the preview data sources, so an RFI, a defect and a diary labour line
// name the same companies and people. Not real businesses.

export interface MockCompany {
  id: string;
  name: string;
  trade: string;
  /** builder = the org that owns the project. */
  role: 'builder' | 'consultant' | 'subcontractor' | 'client';
}

export interface MockPerson {
  id: string;
  name: string;
  companyId: string;
}

export const MOCK_COMPANIES: readonly MockCompany[] = [
  { id: 'cmp_builder', name: 'Harbour Line Constructions', trade: 'Builder', role: 'builder' },
  {
    id: 'cmp_struct',
    name: 'Smith & Lowe Engineers',
    trade: 'Structural engineering',
    role: 'consultant',
  },
  { id: 'cmp_arch', name: 'Fold Architects', trade: 'Architecture', role: 'consultant' },
  { id: 'cmp_elec', name: 'Brightwire Electrical', trade: 'Electrical', role: 'subcontractor' },
  { id: 'cmp_plumb', name: 'Bayside Hydraulics', trade: 'Hydraulics', role: 'subcontractor' },
  { id: 'cmp_tile', name: 'Ironbark Tiling', trade: 'Tiling', role: 'subcontractor' },
  { id: 'cmp_tile2', name: 'Harbour Tile Co', trade: 'Tiling', role: 'subcontractor' },
  { id: 'cmp_tile3', name: 'Granite & Grout', trade: 'Tiling', role: 'subcontractor' },
  { id: 'cmp_form', name: 'Cornerstone Formwork', trade: 'Formwork', role: 'subcontractor' },
  { id: 'cmp_paint', name: 'Coastline Painting', trade: 'Painting', role: 'subcontractor' },
  {
    id: 'cmp_dry',
    name: 'Southern Linings',
    trade: 'Plasterboard and ceilings',
    role: 'subcontractor',
  },
];

export const MOCK_PEOPLE: readonly MockPerson[] = [
  { id: 'usr_pm', name: 'Dana Okafor', companyId: 'cmp_builder' },
  { id: 'usr_sm', name: 'Luca Romano', companyId: 'cmp_builder' },
  { id: 'usr_eng', name: 'Jo Smith', companyId: 'cmp_struct' },
  { id: 'usr_arch', name: 'Mei Lin', companyId: 'cmp_arch' },
  { id: 'usr_elec', name: 'Sam Patel', companyId: 'cmp_elec' },
  { id: 'usr_plumb', name: 'Ruby Walsh', companyId: 'cmp_plumb' },
  { id: 'usr_tile', name: 'Tom Nguyen', companyId: 'cmp_tile' },
];

export function companyName(id: string | null | undefined): string {
  return MOCK_COMPANIES.find((c) => c.id === id)?.name ?? 'Unknown company';
}

export function personName(id: string | null | undefined): string {
  return MOCK_PEOPLE.find((p) => p.id === id)?.name ?? 'Unknown person';
}

export function personCompanyId(id: string | null | undefined): string | null {
  return MOCK_PEOPLE.find((p) => p.id === id)?.companyId ?? null;
}
