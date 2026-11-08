'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@archova/ui';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** The "⋯" actions for one row of the grid. Opens a menu; Escape or a click elsewhere closes it. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={root} style={{ position: 'relative', display: 'inline-block' }}>
      <Button
        variant="secondary"
        size="sm"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          style={{
            position: 'absolute',
            insetInlineEnd: 0,
            zIndex: 10,
            minWidth: '11rem',
            display: 'grid',
            padding: 'var(--space-1)',
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border-control)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {items.map((i) => (
            <Button
              key={i.label}
              role="menuitem"
              variant="tertiary"
              size="sm"
              disabled={i.disabled}
              onClick={() => {
                setOpen(false);
                i.onSelect();
              }}
            >
              {i.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
