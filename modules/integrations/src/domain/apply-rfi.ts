// Turns one validated, staged RFI row into the input of the `rfis` import command (X49). Pure, no IO. The row's fields
// come from `normaliseRow` with the RFI field catalogue, so dates are `YYYY-MM-DD` local dates and the status is one
// of open, answered, closed or void.

import { startOfLocalDay, type LocalDate } from '@archova/time';
import type { Cell } from './normalise';

export interface RfiImportInput {
  sourceRef: string;
  number: number;
  subject: string;
  question: string;
  status: 'open' | 'answered' | 'closed' | 'void';
  dueDate: string | null;
  openedAt: Date;
  answeredAt: Date | null;
  closedAt: Date | null;
  externalAuthor?: { name: string; email: string | null };
  responses: Array<{
    body: string;
    authorName: string;
    authorEmail: string | null;
    createdAt: Date;
    isOfficial: boolean;
  }>;
  importJobId: string;
}

const STATUSES = ['open', 'answered', 'closed', 'void'] as const;
const text = (v: Cell | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The command input for a staged row, or the reason it cannot be applied. A bare date is the project's local date (X34). */
export function toRfiImport(
  fields: Readonly<Record<string, Cell>>,
  timeZone: string,
  jobId: string,
): { ok: true; input: RfiImportInput } | { ok: false; reason: string } {
  const number = fields.number;
  const subject = text(fields.subject);
  const status = STATUSES.find((s) => s === fields.status);
  const opened = text(fields.openedAt);
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1)
    return { ok: false, reason: 'The RFI has no number' };
  if (!subject) return { ok: false, reason: 'The RFI has no subject' };
  if (!status) return { ok: false, reason: 'The RFI has no status' };
  if (!opened) return { ok: false, reason: 'The RFI has no date raised' };
  const at = (v: Cell | undefined): Date | null => {
    const d = text(v);
    return d ? startOfLocalDay(d as LocalDate, timeZone) : null;
  };
  const openedAt = at(opened)!;
  const answeredAt = at(fields.answeredAt);
  const closedAt = at(fields.closedAt);
  const authorName = text(fields.authorName);
  const reply = text(fields.officialResponse);
  return {
    ok: true,
    input: {
      sourceRef: String(number),
      number,
      subject: subject.slice(0, 300),
      question: text(fields.question) ?? subject,
      status,
      dueDate: text(fields.dueDate),
      openedAt,
      answeredAt,
      closedAt,
      ...(authorName
        ? { externalAuthor: { name: authorName, email: text(fields.authorEmail) } }
        : {}),
      responses: reply
        ? [
            {
              body: reply,
              authorName: text(fields.responseBy) ?? 'Unknown',
              authorEmail: null,
              createdAt: answeredAt ?? closedAt ?? openedAt,
              isOfficial: true,
            },
          ]
        : [],
      importJobId: jobId,
    },
  };
}
