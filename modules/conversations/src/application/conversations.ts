import { and, asc, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import type { PlatformApi } from '@archova/mod-platform';
import {
  BODY_MAX,
  SUBJECT_MAX,
  canTakePart,
  cleanBody,
  cleanSubject,
} from '../domain/conversations';
import { messages, threads } from '../infra/tables';

export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type Authors = Map<string, string>;

export interface ConversationsDeps {
  platform: Pick<PlatformApi, 'getProject'>;
  identity: Pick<IdentityApi, 'getUsers'>;
  now?: () => Date;
}

export interface ThreadSummary {
  thread: ThreadRow;
  latest: MessageRow;
}

export function createConversationsService(deps: ConversationsDeps) {
  // Millisecond precision so the keyset cursor (an ISO string) round-trips exactly.
  const now = deps.now ?? (() => new Date());

  function requireTeam(scope: TenantScope) {
    if (!canTakePart(scope.ctx.principalType))
      throw new AppError('access.denied', 'Conversations are for the project team.');
  }

  async function authorNames(ids: readonly string[]): Promise<Authors> {
    const users = await deps.identity.getUsers(ids);
    return new Map([...users].map(([id, u]) => [id, u.name || u.email]));
  }

  function badText(path: 'subject' | 'body', max: number): never {
    throw new AppError('validation_failed', `Enter between 1 and ${max} characters.`, [
      { path, message: `Enter between 1 and ${max} characters` },
    ]);
  }

  async function getThread(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(threads)
      .where(and(eq(threads.id, id), eq(threads.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('conversation.not_found');
    return row;
  }

  /** Newest activity first, each with its latest message for the card preview. */
  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { limit: number; cursor?: string },
  ) {
    requireTeam(scope);
    await deps.platform.getProject(scope, projectId);
    const after = decodeCursor<{ t: string; id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(threads.projectId, projectId)];
    if (after) {
      const t = new Date(after.t);
      conditions.push(
        or(
          lt(threads.lastMessageAt, t),
          and(eq(threads.lastMessageAt, t), lt(threads.id, after.id)),
        )!,
      );
    }
    const rows = await scope.tx
      .select()
      .from(threads)
      .where(and(...conditions))
      .orderBy(desc(threads.lastMessageAt), desc(threads.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ t: r.lastMessageAt.toISOString(), id: r.id }));
    const summaries: ThreadSummary[] = [];
    for (const thread of page.data) {
      const [latest] = await scope.tx
        .select()
        .from(messages)
        .where(eq(messages.threadId, thread.id))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(1);
      if (latest) summaries.push({ thread, latest });
    }
    const names = await authorNames(
      summaries.flatMap((s) => [s.thread.createdBy, s.latest.authorId]),
    );
    return { data: summaries, names, nextCursor: page.nextCursor };
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    requireTeam(scope);
    const thread = await getThread(scope, projectId, id);
    const rows = await scope.tx
      .select()
      .from(messages)
      .where(eq(messages.threadId, id))
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(500);
    const names = await authorNames([thread.createdBy, ...rows.map((m) => m.authorId)]);
    return { thread, messages: rows, names };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: { subject: string; body: string },
  ) {
    requireTeam(scope);
    await deps.platform.getProject(scope, projectId);
    const subject = cleanSubject(input.subject) ?? badText('subject', SUBJECT_MAX);
    const body = cleanBody(input.body) ?? badText('body', BODY_MAX);
    const at = now();
    const threadId = uuidv7();
    await scope.tx.insert(threads).values({
      id: threadId,
      orgId: scope.ctx.orgId,
      projectId,
      subject,
      messageCount: 1,
      lastMessageAt: at,
      createdAt: at,
      createdBy: scope.ctx.userId,
    });
    await scope.tx.insert(messages).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      threadId,
      projectId,
      authorId: scope.ctx.userId,
      body,
      createdAt: at,
    });
    scope.events.add({
      type: 'conversations.thread.created.v1',
      projectId,
      entityType: 'conversation',
      entityId: threadId,
      entityVersion: 1,
      data: { threadId },
    });
    return detail(scope, projectId, threadId);
  }

  async function post(scope: TenantScope, projectId: string, id: string, input: { body: string }) {
    requireTeam(scope);
    const thread = await getThread(scope, projectId, id);
    const body = cleanBody(input.body) ?? badText('body', BODY_MAX);
    const at = now();
    await scope.tx.insert(messages).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      threadId: id,
      projectId,
      authorId: scope.ctx.userId,
      body,
      createdAt: at,
    });
    await scope.tx
      .update(threads)
      .set({ messageCount: sql`${threads.messageCount} + 1`, lastMessageAt: at })
      .where(eq(threads.id, id));
    scope.events.add({
      type: 'conversations.message.posted.v1',
      projectId,
      entityType: 'conversation',
      entityId: id,
      entityVersion: thread.messageCount + 1,
      data: { threadId: id },
    });
    return detail(scope, projectId, id);
  }

  return { list, detail, create, post };
}

export type ConversationsService = ReturnType<typeof createConversationsService>;
