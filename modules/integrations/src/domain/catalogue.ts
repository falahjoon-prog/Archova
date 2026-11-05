// The integrations marketplace (integrations/06 §4): one list of everything an org can connect to Archova, with each
// entry's live status. A connector is added by appending one entry to CATALOGUE and mapping its state in
// `buildCatalogue`; the web page renders whatever this returns, so a new connector needs no new screen shell.

export type CatalogueCategory = 'accounting' | 'files' | 'developer';
export type CatalogueStatus =
  'connected' | 'available' | 'needs_attention' | 'not_configured' | 'coming_soon';
/** Where an admin goes to set the entry up; the web app maps each to its own route. */
export type CatalogueManage = 'accounting' | 'folders' | 'api';

export interface CatalogueEntry {
  key: string;
  name: string;
  category: CatalogueCategory;
  summary: string;
  status: CatalogueStatus;
  /** What is wrong or what is set up, when there is something to say. */
  detail: string | null;
  manage: CatalogueManage | null;
}

interface Definition {
  key: string;
  name: string;
  category: CatalogueCategory;
  summary: string;
  manage: CatalogueManage | null;
  /** Roadmap entries are listed so admins can see what is coming, but cannot be opened. */
  comingSoon?: boolean;
}

const CATALOGUE: readonly Definition[] = [
  {
    key: 'xero',
    name: 'Xero',
    category: 'accounting',
    summary: 'Send progress claims and variations to Xero as invoices and read payments back.',
    manage: 'accounting',
  },
  {
    key: 'myob',
    name: 'MYOB Business',
    category: 'accounting',
    summary: 'Send progress claims and variations to MYOB Business and read payments back.',
    manage: 'accounting',
  },
  {
    key: 'm365',
    name: 'Microsoft 365 (SharePoint)',
    category: 'files',
    summary: 'Publish a project’s current drawings to a SharePoint folder.',
    manage: 'folders',
  },
  {
    key: 'google',
    name: 'Google Drive',
    category: 'files',
    summary: 'Publish a project’s current drawings to a Google Drive folder.',
    manage: 'folders',
  },
  {
    key: 'api',
    name: 'Public API and webhooks',
    category: 'developer',
    summary: 'Personal access tokens for scripts and signed event notices to your own systems.',
    manage: 'api',
  },
  {
    key: 'power_automate',
    name: 'Microsoft Power Automate',
    category: 'developer',
    summary: 'Triggers and actions for RFIs, defects and documents in Power Automate flows.',
    manage: null,
    comingSoon: true,
  },
  {
    key: 'zapier',
    name: 'Zapier',
    category: 'developer',
    summary: 'Connect Archova to the long tail of HR, CRM and messaging tools.',
    manage: null,
    comingSoon: true,
  },
];

export interface ConnectionState {
  status: 'pending' | 'needs_target' | 'active' | 'error';
  lastError: string | null;
}

export interface CatalogueInput {
  /** Providers this installation holds app credentials for; others are listed as not configured. */
  accountingAvailable: readonly string[];
  folderAvailable: readonly string[];
  accounting: ReadonlyMap<string, ConnectionState>;
  folders: ReadonlyMap<string, ConnectionState>;
  activeWebhooks: number;
}

function connectorStatus(
  available: boolean,
  conn: ConnectionState | undefined,
): Pick<CatalogueEntry, 'status' | 'detail'> {
  if (conn?.status === 'active') return { status: 'connected', detail: null };
  if (conn?.status === 'error')
    return { status: 'needs_attention', detail: conn.lastError ?? 'Needs reconnecting.' };
  if (conn?.status === 'needs_target')
    return { status: 'needs_attention', detail: 'Sign-in done; choose the organisation to use.' };
  if (conn?.status === 'pending')
    return { status: 'needs_attention', detail: 'Sign-in not finished.' };
  return available
    ? { status: 'available', detail: null }
    : { status: 'not_configured', detail: 'Not set up on this installation yet.' };
}

export function buildCatalogue(input: CatalogueInput): CatalogueEntry[] {
  return CATALOGUE.map((d) => {
    const base = {
      key: d.key,
      name: d.name,
      category: d.category,
      summary: d.summary,
      manage: d.manage,
    };
    if (d.comingSoon) return { ...base, status: 'coming_soon', detail: null };
    if (d.category === 'accounting')
      return {
        ...base,
        ...connectorStatus(input.accountingAvailable.includes(d.key), input.accounting.get(d.key)),
      };
    if (d.category === 'files')
      return {
        ...base,
        ...connectorStatus(input.folderAvailable.includes(d.key), input.folders.get(d.key)),
      };
    // The API is always on; it counts as connected once an endpoint is subscribed.
    return input.activeWebhooks > 0
      ? {
          ...base,
          status: 'connected',
          detail: `${input.activeWebhooks} webhook endpoint${input.activeWebhooks === 1 ? '' : 's'} active.`,
        }
      : { ...base, status: 'available', detail: null };
  });
}
