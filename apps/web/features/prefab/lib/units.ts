// Pure helpers for the prefab board: labels, the next step for a unit, and the rule-based answers Nova gives to
// questions about the board. Nothing here calls a model, so asking costs no credits.

import { formatLocalDate } from '@/shared/lib/format';
import type { Flag, Unit, UnitKind, UnitStatus } from '../data/api';

export const KIND_LABELS: Record<UnitKind, string> = {
  bathroom_pod: 'Bathroom pod',
  wall_panel: 'Wall panel',
  floor_cassette: 'Floor cassette',
  volumetric_module: 'Volumetric module',
  roof_truss: 'Roof truss',
  facade_panel: 'Facade panel',
  services_riser: 'Services riser',
  other: 'Other',
};

export const STATUS_LABELS: Record<UnitStatus, string> = {
  planned: 'Planned',
  in_fabrication: 'In fabrication',
  qa_hold: 'QA hold',
  ready_to_ship: 'Ready to ship',
  in_transit: 'In transit',
  on_site: 'On site',
  installed: 'Installed',
  rejected: 'Rejected',
};
export const STATUS_TONES = {
  planned: 'neutral',
  in_fabrication: 'info',
  qa_hold: 'danger',
  ready_to_ship: 'info',
  in_transit: 'warning',
  on_site: 'warning',
  installed: 'success',
  rejected: 'danger',
} as const;

export type ActionName =
  'start' | 'hold' | 'resume' | 'ready' | 'ship' | 'deliver' | 'install' | 'reject' | 'reopen';

/** The step a person normally takes next from each status, and the other moves open to them. */
export const NEXT_STEP: Record<UnitStatus, { main: ActionName | null; others: ActionName[] }> = {
  planned: { main: 'start', others: [] },
  in_fabrication: { main: 'ready', others: ['hold', 'reject'] },
  qa_hold: { main: 'resume', others: ['reject'] },
  ready_to_ship: { main: 'ship', others: ['hold', 'reject'] },
  in_transit: { main: 'deliver', others: ['reject'] },
  on_site: { main: 'install', others: ['reject'] },
  installed: { main: null, others: [] },
  rejected: { main: 'reopen', others: [] },
};
export const ACTION_LABELS: Record<ActionName, string> = {
  start: 'Start fabrication',
  hold: 'Put on QA hold',
  resume: 'Resume fabrication',
  ready: 'Release to ship',
  ship: 'Mark shipped',
  deliver: 'Arrived on site',
  install: 'Mark installed',
  reject: 'Reject',
  reopen: 'Reopen',
};
/** Moves that need a reason typed in. */
export const NEEDS_REASON: readonly ActionName[] = ['hold', 'reject'];

export const FLAG_LABELS: Record<Flag['kind'], string> = {
  fab_late: 'Fabrication late',
  fab_not_started: 'Not started',
  qa_hold: 'QA hold',
  ship_late: 'Shipping late',
  delivery_not_booked: 'No delivery booked',
  install_overdue: 'Install overdue',
  out_of_sequence: 'Out of sequence',
  dates_inconsistent: 'Dates out of order',
};
export const SEVERITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const;

export const fmtDate = (d: string | null) => (d ? formatLocalDate(d) : '—');
export const isOpen = (u: Pick<Unit, 'status'>) =>
  u.status !== 'installed' && u.status !== 'rejected';

export interface Answer {
  text: string;
  unitIds: string[];
}

const list = (units: readonly Unit[]) => units.map((u) => u.code).join(', ');

/** Answers a few kinds of question straight from the board; anything else gets a hint about what to ask. */
export function answerQuestion(
  question: string,
  ctx: { units: readonly Unit[]; flags: readonly Flag[]; today: string },
): Answer {
  const q = question.toLowerCase();
  const { units, flags, today } = ctx;
  const byId = new Map(units.map((u) => [u.id, u]));
  const flagged = (kinds: readonly Flag['kind'][]) =>
    [...new Set(flags.filter((f) => kinds.includes(f.kind)).map((f) => f.unitId))]
      .map((id) => byId.get(id))
      .filter((u): u is Unit => !!u);
  const reply = (text: string, found: readonly Unit[] = []): Answer => ({
    text,
    unitIds: found.map((u) => u.id),
  });

  if (/hold|qa|fail|reject/.test(q)) {
    const held = units.filter(
      (u) => u.status === 'qa_hold' || u.status === 'rejected' || u.qaFailed > 0,
    );
    return held.length === 0
      ? reply('Nothing is on QA hold, rejected or carrying a failed check.')
      : reply(
          `${held.length} unit${held.length === 1 ? ' needs' : 's need'} QA attention: ${list(held)}.`,
          held,
        );
  }
  if (/late|behind|overdue|delay/.test(q)) {
    const late = flagged(['fab_late', 'fab_not_started', 'ship_late', 'install_overdue']);
    return late.length === 0
      ? reply('Nothing is behind its dates.')
      : reply(
          `${late.length} unit${late.length === 1 ? ' is' : 's are'} behind: ${list(late)}.`,
          late,
        );
  }
  if (/sequence|order/.test(q)) {
    const out = flagged(['out_of_sequence']);
    return out.length === 0
      ? reply('The install sequence is holding.')
      : reply(`Out of sequence: ${list(out)}.`, out);
  }
  if (/deliver|truck|book/.test(q)) {
    const unbooked = flagged(['delivery_not_booked']);
    return unbooked.length === 0
      ? reply('Every unit shipping in the next week has a delivery booked.')
      : reply(`Shipping soon with no site delivery booked: ${list(unbooked)}.`, unbooked);
  }
  if (/next|install|coming|this week|soon/.test(q)) {
    const next = units
      .filter((u) => isOpen(u) && u.installDate && u.installDate >= today)
      .sort((a, b) => a.installDate!.localeCompare(b.installDate!))
      .slice(0, 5);
    return next.length === 0
      ? reply('No installs are scheduled.')
      : reply(
          `Next to install: ${next.map((u) => `${u.code} (${fmtDate(u.installDate)})`).join(', ')}.`,
          next,
        );
  }
  return reply(
    'Try: what is late, what is on QA hold, what installs next, or are deliveries booked.',
  );
}
