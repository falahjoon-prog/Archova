import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export type AlertTone = 'danger' | 'warning' | 'info' | 'success';

const ICON: Record<AlertTone, string> = { danger: '!', warning: '!', info: 'i', success: '✓' };

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Optional action (e.g. "View current"), shown at the end of the alert. */
  action?: ReactNode;
}

/**
 * Status message. Colour is always paired with an icon and text (design 02 §2.2).
 * Danger alerts use `role="alert"` so screen readers announce them immediately; others use `role="status"`.
 */
export function Alert({ tone = 'info', title, children, className, action }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('ac-alert', `ac-alert--${tone}`, className)}
    >
      <span className="ac-alert__icon" aria-hidden="true">
        {ICON[tone]}
      </span>
      <div className="ac-alert__body">
        {title ? <p className="ac-alert__title">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="ac-alert__action">{action}</div> : null}
    </div>
  );
}

/** Form-level error: renders nothing when there is no message. */
export function FormError({
  message,
  title,
}: {
  message: ReactNode | null | undefined;
  title?: ReactNode;
}) {
  if (!message) return null;
  return (
    <Alert tone="danger" title={title}>
      {message}
    </Alert>
  );
}
