import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { ConversationsService } from '../application/conversations';
import { toDetail, toSummary } from './mappers';

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const threadId = (p: { conversationId: string }) => {
  const id = decodeId('conversation', p.conversationId);
  if (!id) throw new AppError('conversation.not_found');
  return id;
};

export function conversationsRoutes(database: Database, svc: ConversationsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  return defineRoutes({
    listConversations: async (input) => {
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          data: page.data.map((x) => toSummary(x, page.names)),
          nextCursor: page.nextCursor,
        },
      };
    },
    createConversation: async (input) => ({
      status: 201,
      body: toDetail(await tx(input, (s) => svc.create(s, project(input.params), input.body))),
    }),
    getConversation: async (input) => ({
      status: 200,
      body: toDetail(
        await read(input, (s) => svc.detail(s, project(input.params), threadId(input.params))),
      ),
    }),
    postConversationMessage: async (input) => ({
      status: 201,
      body: toDetail(
        await tx(input, (s) =>
          svc.post(s, project(input.params), threadId(input.params), input.body),
        ),
      ),
    }),
  });
}
