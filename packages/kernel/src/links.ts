import type { TenantScope } from './db';
import type { SearchHit } from './search';

/** Headline details of one record, as the Related items panel shows it. */
export interface LinkSummary {
  /** Internal id; `links` encodes it for the API. */
  id: string;
  /** Human reference such as `RFI-012`. */
  ref: string;
  title: string;
  status: string;
}

/**
 * What a tool module gives `links` so records can be linked and listed without `links` knowing any tool's tables.
 * Both calls must apply the tool's own permission and visibility rules for the caller, so a link never reveals a
 * record the person could not open from that tool.
 */
export interface LinkSource {
  /** The records among `ids` the caller may open; ids not returned are missing or hidden. */
  summaries(
    scope: TenantScope,
    projectId: string,
    ids: readonly string[],
  ): Promise<readonly LinkSummary[]>;
  /** Pick-list for "Add link": records the caller can open that match some words. */
  searchHits(
    scope: TenantScope,
    projectId: string,
    q: string,
    limit: number,
  ): Promise<{ restricted: boolean; hits: readonly SearchHit[] }>;
}
