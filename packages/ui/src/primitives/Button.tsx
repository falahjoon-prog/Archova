import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  /** Shows a pending state: the button is disabled and announced as busy. */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  type = 'button',
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('ac-button', `ac-button--${variant}`, className)}
    >
      {children}
    </button>
  );
}

/** Button styling for elements that must stay links (e.g. a Next.js `<Link>` that navigates). */
export function buttonClassName(variant: ButtonVariant = 'primary', className?: string): string {
  return cx('ac-button', `ac-button--${variant}`, className);
}
