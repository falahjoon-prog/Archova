import { encodeId } from '@archova/domain';
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationSummary,
} from '@archova/contracts';
import type { Authors, MessageRow, ThreadRow, ThreadSummary } from '../application/conversations';

const nameOf = (names: Authors, id: string) => names.get(id) ?? 'Former team member';

const toMessage = (m: MessageRow, names: Authors): ConversationMessage => ({
  id: encodeId('conversationMessage', m.id),
  authorId: encodeId('user', m.authorId),
  authorName: nameOf(names, m.authorId),
  body: m.body,
  mentionedUserIds: m.mentions.map((u) => encodeId('user', u)),
  createdAt: m.createdAt.toISOString(),
});

export const toSummary = (s: ThreadSummary, names: Authors): ConversationSummary => ({
  id: encodeId('conversation', s.thread.id),
  projectId: encodeId('project', s.thread.projectId),
  subject: s.thread.subject,
  messageCount: s.thread.messageCount,
  createdById: encodeId('user', s.thread.createdBy),
  createdByName: nameOf(names, s.thread.createdBy),
  lastMessage: toMessage(s.latest, names),
  lastMessageAt: s.thread.lastMessageAt.toISOString(),
});

export const toDetail = (d: {
  thread: ThreadRow;
  messages: MessageRow[];
  names: Authors;
}): ConversationDetail => ({
  id: encodeId('conversation', d.thread.id),
  projectId: encodeId('project', d.thread.projectId),
  subject: d.thread.subject,
  messageCount: d.thread.messageCount,
  createdById: encodeId('user', d.thread.createdBy),
  createdByName: nameOf(d.names, d.thread.createdBy),
  createdAt: d.thread.createdAt.toISOString(),
  messages: d.messages.map((m) => toMessage(m, d.names)),
});
