// Pure helpers for the audit log: turning an outbox row into a line a person can read.

export type AuditActorKind = 'user' | 'link' | 'system';

export interface RawActor {
  type?: string;
  id?: string;
}

/** `rfis.rfi.created.v1` -> action `rfis.rfi.created`, module `rfis`. */
export function parseEventType(type: string): { action: string; module: string } {
  const action = type.replace(/\.v\d+$/, '');
  return { action, module: action.split('.')[0] ?? action };
}

export function actorKind(actor: RawActor | null | undefined): AuditActorKind {
  if (actor?.type === 'user') return 'user';
  if (actor?.type === 'link') return 'link';
  return 'system';
}

/** A readable sentence: "rfis.rfi.created" -> "Rfi created". */
export function describeAction(action: string): string {
  const parts = action.split('.');
  const verb = parts[parts.length - 1] ?? action;
  const subject = (parts.length > 2 ? parts[parts.length - 2] : (parts[0] ?? '')) ?? '';
  const words = (s: string) => s.replace(/_/g, ' ');
  const text = `${words(subject)} ${words(verb)}`.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;
