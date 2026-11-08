// The project tools a person can open from the Tools tab, one tile each. Only tools that exist on the phone are
// listed; the rest of the platform stays on the web until its mobile screens are built.
import { mobileRoutes } from '@archova/routes';

export type ToolId =
  | 'drawings'
  | 'diary'
  | 'voice'
  | 'defects'
  | 'inspections'
  | 'incidents'
  | 'siteSignIn'
  | 'induction'
  | 'rollCall'
  | 'meetings'
  | 'tenders'
  | 'documents'
  | 'specifications'
  | 'submittals'
  | 'timesheets'
  | 'crews'
  | 'ownerPortal';

export interface ToolDef {
  id: ToolId;
  label: string;
  /** Stroke paths of a 24 by 24 line icon. */
  icon: readonly string[];
  route: (projectId: string) => string;
}

export const TOOLS: readonly ToolDef[] = [
  {
    id: 'drawings',
    label: 'Drawings',
    icon: ['M3 4h18v16H3z', 'M3 9h18', 'M9 9v11'],
    route: mobileRoutes.drawings,
  },
  {
    id: 'diary',
    label: 'Site diary',
    icon: ['M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z', 'M8 8h7', 'M8 12h7'],
    route: mobileRoutes.diary,
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: [
      'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z',
      'M6 11a6 6 0 0 0 12 0',
      'M12 17v4',
    ],
    route: mobileRoutes.voice,
  },
  {
    id: 'defects',
    label: 'Defects',
    icon: ['M12 3l10 18H2L12 3z', 'M12 10v5', 'M12 18v.01'],
    route: mobileRoutes.defects,
  },
  {
    id: 'inspections',
    label: 'Inspections',
    icon: ['M9 4h6v3H9z', 'M7 5H5v16h14V5h-2', 'M8 14l3 3 5-6'],
    route: mobileRoutes.inspections,
  },
  {
    id: 'incidents',
    label: 'Incidents',
    icon: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z', 'M12 8v5', 'M12 16v.01'],
    route: mobileRoutes.incidents,
  },
  {
    id: 'siteSignIn',
    label: 'Site sign-in',
    icon: ['M10 4H5v16h5', 'M14 8l4 4-4 4', 'M18 12H9'],
    route: mobileRoutes.siteSignIn,
  },
  {
    id: 'induction',
    label: 'Induction',
    icon: ['M2 8l10-4 10 4-10 4L2 8z', 'M6 10v5c0 1.5 3 3 6 3s6-1.5 6-3v-5'],
    route: mobileRoutes.induction,
  },
  {
    id: 'rollCall',
    label: 'Roll call',
    icon: [
      'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6',
      'M17 8a2.5 2.5 0 1 1 0 5',
      'M21 19c0-2.5-1.5-4.5-4-5',
    ],
    route: mobileRoutes.rollCall,
  },
  {
    id: 'meetings',
    label: 'Meetings',
    icon: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
    route: mobileRoutes.meetings,
  },
  {
    id: 'tenders',
    label: 'Tenders',
    icon: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 13h6', 'M9 17h6'],
    route: mobileRoutes.tenders,
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: ['M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z'],
    route: mobileRoutes.documents,
  },
  {
    id: 'specifications',
    label: 'Specs',
    icon: ['M5 3h10l4 4v14H5z', 'M15 3v4h4', 'M8 11h8', 'M8 15h8', 'M8 19h5'],
    route: mobileRoutes.specifications,
  },
  {
    id: 'submittals',
    label: 'Submittals',
    icon: ['M4 4h16v16H4z', 'M8 12l3 3 5-6'],
    route: mobileRoutes.submittals,
  },
  {
    id: 'timesheets',
    label: 'Timesheets',
    icon: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
    route: mobileRoutes.timesheets,
  },
  {
    id: 'crews',
    label: 'Crews',
    icon: [
      'M4 20c0-3 2.5-5 5-5s5 2 5 5',
      'M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      'M16 6h5',
      'M16 10h5',
      'M16 14h5',
    ],
    route: mobileRoutes.crews,
  },
  {
    id: 'ownerPortal',
    label: 'Owner portal',
    icon: ['M5 21V5l7-2 7 2v16', 'M9 9h2', 'M13 9h2', 'M9 13h2', 'M13 13h2', 'M10 21v-4h4v4'],
    route: mobileRoutes.ownerPortal,
  },
];

/** How many tiles fit across: three on a phone, more on a tablet or a phone on its side. */
export function gridColumns(width: number): number {
  if (width >= 900) return 5;
  if (width >= 600) return 4;
  return 3;
}
