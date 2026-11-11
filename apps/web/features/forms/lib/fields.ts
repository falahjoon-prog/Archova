import type { FormField } from '../data/api';

export const FIELD_TYPE_LABELS: Record<FormField['type'], string> = {
  heading: 'Heading or instructions',
  text: 'Short text',
  longtext: 'Long text',
  number: 'Number',
  date: 'Date',
  checkbox: 'Tick box',
  select: 'Dropdown',
  checklist: 'Checklist',
  table: 'Table',
  photo: 'Photos',
  signature: 'Signatures',
};

export const CATEGORY_LABELS = {
  safety: 'Safety',
  quality: 'Quality',
  site: 'Site',
  admin: 'Admin',
  general: 'General',
} as const;

export const LINK_LABELS = {
  diary: 'Daily log',
  incidents: 'Incidents',
  inspections: 'Inspections',
  attendance: 'Attendance',
} as const;

/** A key like `text_3` that no other field uses. */
export function newKey(type: FormField['type'], fields: readonly FormField[]): string {
  const taken = new Set(fields.map((f) => f.key));
  for (let i = fields.length + 1; ; i++) {
    const key = `${type}_${i}`;
    if (!taken.has(key)) return key;
  }
}

export function newField(type: FormField['type'], fields: readonly FormField[]): FormField {
  const base: FormField = { key: newKey(type, fields), type, label: FIELD_TYPE_LABELS[type] };
  if (type === 'select' || type === 'checklist') return { ...base, options: ['Option 1'] };
  if (type === 'table')
    return {
      ...base,
      columns: [
        { key: 'column_1', label: 'Column 1' },
        { key: 'column_2', label: 'Column 2' },
      ],
      rows: 3,
    };
  if (type === 'signature') return { ...base, slots: 10 };
  return base;
}

/** Moves the item at `from` so it sits at `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length)
    return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export const groupBy = <T>(items: readonly T[], key: (t: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const i of items) groups.set(key(i), [...(groups.get(key(i)) ?? []), i]);
  return [...groups.entries()];
};
