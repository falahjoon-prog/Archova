'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons, right-aligned. Put the primary action last. */
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * Modal dialog for confirmations and short forms only (design 02 §7.5). Built on the native `<dialog>` element,
 * which gives focus trapping, Esc to close and an inert background; focus returns to the opener on close.
 */
export function Dialog({ open, onClose, title, description, footer, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      // jsdom has no showModal; fall back to the open attribute so tests still render the content.
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ac-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open ? (
        <div className="ac-dialog__frame">
          <div className="ac-dialog__header">
            <h2 id={titleId} className="ac-dialog__title">
              {title}
            </h2>
            <button
              type="button"
              className="ac-icon-button ac-focusable"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          {description ? (
            <p id={descId} className="ac-dialog__description">
              {description}
            </p>
          ) : null}
          {children ? <div className="ac-dialog__body">{children}</div> : null}
          {footer ? <div className="ac-dialog__footer">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
