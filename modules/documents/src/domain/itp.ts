// ITP rules (pure). Hold points are sequential: a later hold point cannot be signed while an earlier one is
// still open. A package is complete only when no point is pending or failed.
import type { ItpItemStatus, ItpPointType } from '../infra/tables';

export interface ItemState {
  id: string;
  sort: number;
  pointType: ItpPointType;
  status: ItpItemStatus;
}

/** The earlier hold point still blocking this item, or null. Only hold points block, and only later items. */
export function blockingHold(items: readonly ItemState[], itemId: string): ItemState | null {
  const target = items.find((i) => i.id === itemId);
  if (!target) return null;
  return (
    items
      .filter(
        (i) =>
          i.pointType === 'hold' &&
          i.sort < target.sort &&
          i.status !== 'passed' &&
          i.status !== 'waived',
      )
      .sort((a, b) => a.sort - b.sort)[0] ?? null
  );
}

export function canComplete(items: readonly ItemState[]): boolean {
  return items.length > 0 && items.every((i) => i.status === 'passed' || i.status === 'waived');
}

export function progress(items: readonly ItemState[]) {
  const total = items.length;
  const done = items.filter((i) => i.status === 'passed' || i.status === 'waived').length;
  return {
    total,
    done,
    failed: items.filter((i) => i.status === 'failed').length,
    holdOpen: items.filter(
      (i) => i.pointType === 'hold' && i.status !== 'passed' && i.status !== 'waived',
    ).length,
  };
}

/** Starter points for a trade (Nova's suggestion, rules only). The person edits them before activating. */
export const ITP_TEMPLATES: Record<
  string,
  { description: string; acceptanceCriteria: string; pointType: ItpPointType }[]
> = {
  concrete: [
    {
      description: 'Formwork and reinforcement inspected before pour',
      acceptanceCriteria: 'Cover, lap lengths and bar spacing match the structural drawings',
      pointType: 'hold',
    },
    {
      description: 'Concrete delivery docket and slump test',
      acceptanceCriteria: 'Mix and slump within the specification',
      pointType: 'witness',
    },
    {
      description: 'Curing in place',
      acceptanceCriteria: 'Curing method and duration as specified',
      pointType: 'surveillance',
    },
    {
      description: 'Cylinder results at 28 days',
      acceptanceCriteria: 'Strength at or above the specified grade',
      pointType: 'hold',
    },
  ],
  waterproofing: [
    {
      description: 'Substrate prepared and primed',
      acceptanceCriteria: 'Clean, dry, falls to drain, penetrations sealed',
      pointType: 'hold',
    },
    {
      description: 'Membrane applied to specified thickness',
      acceptanceCriteria: 'Coats and cure times to the manufacturer data sheet',
      pointType: 'witness',
    },
    {
      description: 'Flood test for 24 hours',
      acceptanceCriteria: 'No leaks or level drop',
      pointType: 'hold',
    },
  ],
  fire: [
    {
      description: 'Penetrations sealed with tested system',
      acceptanceCriteria: 'System and installation match the fire engineering report',
      pointType: 'hold',
    },
    {
      description: 'Collars and wraps installed',
      acceptanceCriteria: 'Fixed per the tested detail',
      pointType: 'witness',
    },
    {
      description: 'Photographic record and labels',
      acceptanceCriteria: 'Every penetration labelled and photographed',
      pointType: 'surveillance',
    },
  ],
  general: [
    {
      description: 'Materials and shop drawings approved before work starts',
      acceptanceCriteria: 'Approved submittal on file',
      pointType: 'hold',
    },
    {
      description: 'Work inspected while in progress',
      acceptanceCriteria: 'Matches the approved drawings and specification',
      pointType: 'surveillance',
    },
    {
      description: 'Completed work inspected and signed off',
      acceptanceCriteria: 'No open defects',
      pointType: 'hold',
    },
  ],
};

export function templateFor(discipline: string | null | undefined) {
  const k = (discipline ?? '').toLowerCase();
  const key = Object.keys(ITP_TEMPLATES).find((t) => t !== 'general' && k.includes(t)) ?? 'general';
  return { key, items: ITP_TEMPLATES[key]! };
}
