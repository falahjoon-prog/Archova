import { sql } from 'drizzle-orm';
import type { TenantScope } from './db';

/** Sam 11 §6: codes go 7 days after expiry, sessions after 90, network details after 30, recipient emails after 90. */
export const ACCESS_LINK_RETENTION_DAYS = {
  codesAfterExpiry: 7,
  sessionsAfterExpiry: 90,
  sessionNetworkDetails: 30,
  recipientEmailAfterLinkExpiry: 90,
} as const;

export interface AccessLinkPurgeResult {
  codesDeleted: number;
  sessionsDeleted: number;
  networkDetailsCleared: number;
  emailsCleared: number;
}

/**
 * Removes what a finished access link no longer needs, for the org of `scope` (RLS does the scoping). Idempotent:
 * a second run finds nothing. The link rows themselves stay as the record of who was invited to do what.
 */
export async function purgeAccessLinks(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<AccessLinkPurgeResult> {
  const days = ACCESS_LINK_RETENTION_DAYS;
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  // Codes of an expired session go with the session, so the foreign key never blocks the session delete.
  const codes = await scope.tx.execute(sql`
    delete from shared.access_link_codes
    where expires_at < ${ago(days.codesAfterExpiry)}
       or session_id in (select id from shared.access_link_sessions where expires_at < ${ago(days.sessionsAfterExpiry)})`);
  const sessions = await scope.tx.execute(sql`
    delete from shared.access_link_sessions where expires_at < ${ago(days.sessionsAfterExpiry)}`);
  const network = await scope.tx.execute(sql`
    update shared.access_link_sessions set ip = null, user_agent = null
    where created_at < ${ago(days.sessionNetworkDetails)} and (ip is not null or user_agent is not null)`);
  const emails = await scope.tx.execute(sql`
    update shared.access_links
    set recipient_email = null
    where expires_at < ${ago(days.recipientEmailAfterLinkExpiry)} and recipient_email is not null`);

  return {
    codesDeleted: codes.rowCount ?? 0,
    sessionsDeleted: sessions.rowCount ?? 0,
    networkDetailsCleared: network.rowCount ?? 0,
    emailsCleared: emails.rowCount ?? 0,
  };
}
