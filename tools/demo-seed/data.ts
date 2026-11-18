// The synthetic demo tenant. Every name, address and email is made up; emails use example.com (RFC 2606).

export const ORG = {
  name: 'Harbour Line Constructions',
  slug: 'harbour-line',
  country: 'AU',
  timezone: 'Australia/Sydney',
};

export const COMPANIES = [
  { key: 'arch', name: 'Coastline Architects', type: 'consultant', trades: ['Architecture'] },
  {
    key: 'struct',
    name: 'Keel Structural Engineers',
    type: 'consultant',
    trades: ['Structural engineering'],
  },
  { key: 'elec', name: 'Brightwater Electrical', type: 'subcontractor', trades: ['Electrical'] },
  {
    key: 'conc',
    name: 'Southern Cross Concreting',
    type: 'subcontractor',
    trades: ['Concrete', 'Formwork'],
  },
  {
    key: 'hyd',
    name: 'Ridgeview Hydraulics',
    type: 'subcontractor',
    trades: ['Plumbing', 'Hydraulics'],
  },
  { key: 'client', name: 'Paddington Living Pty Ltd', type: 'client', trades: [] },
] as const;

export type CompanyKey = (typeof COMPANIES)[number]['key'];

interface Sheet {
  number: string;
  title: string;
  discipline: string;
}

export interface DemoProject {
  name: string;
  number: string;
  status: 'tender' | 'active';
  state: 'NSW' | 'QLD' | 'VIC';
  timezone: string;
  address: { line1: string; suburb: string; state: 'NSW' | 'QLD' | 'VIC'; postcode: string };
  siteLocation: { lat: number; lng: number };
  startDate: string;
  endDate: string;
  sheets: Sheet[];
  documents: Array<{ folder: string; title: string; docNumber: string; docType: string }>;
}

const ARCH: Sheet[] = [
  { number: 'A-001', title: 'Cover Sheet and Drawing List', discipline: 'A' },
  { number: 'A-101', title: 'Ground Floor Plan', discipline: 'A' },
  { number: 'A-102', title: 'Level 1 Floor Plan', discipline: 'A' },
  { number: 'A-201', title: 'North and South Elevations', discipline: 'A' },
  { number: 'A-301', title: 'Sections A-A and B-B', discipline: 'A' },
  { number: 'S-101', title: 'Footing and Slab Plan', discipline: 'S' },
  { number: 'S-201', title: 'Structural Details Sheet 1', discipline: 'S' },
  { number: 'E-101', title: 'Ground Floor Lighting and Power', discipline: 'E' },
  { number: 'H-101', title: 'Hydraulic Services Ground Floor', discipline: 'H' },
];

export const DOCS = [
  {
    folder: 'Contracts',
    title: 'Head Contract AS 4000 (sample)',
    docNumber: 'CON-001',
    docType: 'Contract',
  },
  {
    folder: 'Specifications',
    title: 'Architectural Specification',
    docNumber: 'SPC-A-001',
    docType: 'Specification',
  },
  {
    folder: 'Specifications',
    title: 'Structural Specification',
    docNumber: 'SPC-S-001',
    docType: 'Specification',
  },
  { folder: 'Safety', title: 'Site Safety Management Plan', docNumber: 'WHS-001', docType: 'Plan' },
  {
    folder: 'Safety',
    title: 'SWMS: Working at Heights',
    docNumber: 'WHS-SWMS-004',
    docType: 'SWMS',
  },
];

export const PROJECTS: DemoProject[] = [
  {
    name: 'Paddington Terraces',
    number: 'HL-2401',
    status: 'active',
    state: 'NSW',
    timezone: 'Australia/Sydney',
    address: { line1: '12 Sample Lane', suburb: 'Paddington', state: 'NSW', postcode: '2021' },
    siteLocation: { lat: -33.8846, lng: 151.2265 },
    startDate: '2026-03-02',
    endDate: '2027-08-27',
    sheets: ARCH,
    documents: DOCS,
  },
  {
    name: 'Fortitude Valley Fit-out',
    number: 'HL-2407',
    status: 'active',
    state: 'QLD',
    timezone: 'Australia/Brisbane',
    address: {
      line1: '200 Example Street',
      suburb: 'Fortitude Valley',
      state: 'QLD',
      postcode: '4006',
    },
    siteLocation: { lat: -27.4575, lng: 153.0355 },
    startDate: '2026-07-13',
    endDate: '2027-02-19',
    sheets: ARCH.filter((s) => s.discipline !== 'S'),
    documents: DOCS,
  },
  {
    name: 'Docklands Residential Tower',
    number: 'HL-2502',
    status: 'tender',
    state: 'VIC',
    timezone: 'Australia/Melbourne',
    address: {
      line1: '1 Demonstration Wharf',
      suburb: 'Docklands',
      state: 'VIC',
      postcode: '3008',
    },
    siteLocation: { lat: -37.8163, lng: 144.9447 },
    startDate: '2027-01-11',
    endDate: '2029-06-29',
    sheets: ARCH.slice(0, 5),
    documents: DOCS.slice(0, 3),
  },
];
