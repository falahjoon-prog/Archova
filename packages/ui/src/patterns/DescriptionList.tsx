import type { ReactNode } from 'react';

export interface DescriptionItem {
  label: ReactNode;
  value: ReactNode;
  /** Use the monospace style for numbers, codes and ids. */
  mono?: boolean;
}

/** Key/value details for an item (design 02 §7.4). */
export function DescriptionList({ items }: { items: readonly DescriptionItem[] }) {
  return (
    <dl className="ac-dl">
      {items.map((item, i) => (
        <div key={i} className="ac-dl__row">
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'ac-mono' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
