import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'nova';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** One primary per view (design 02 §7.1). `nova` is for Nova actions only ("Draft response with Nova"). */
  variant?: ButtonVariant;
  /** `sm` is for dense toolbars and table rows; it keeps the 44 px touch target via padding on touch devices. */
  size?: ButtonSize;
  /** Shows a pending state: the button is disabled and announced as busy, and keeps its width. */
  loading?: boolean;
  /** Icon-only buttons must still have an accessible name: pass `aria-label`. */
  iconOnly?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconOnly = false,
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
      className={buttonClassName(
        variant,
        cx(size === 'sm' && 'ac-button--sm', iconOnly && 'ac-button--icon', className),
      )}
    >
      {children}
    </button>
  );
}

/** Button styling for elements that must stay links (e.g. a Next.js `<Link>` that navigates). */
export function buttonClassName(variant: ButtonVariant = 'primary', className?: string): string {
  return cx('ac-button', `ac-button--${variant}`, className);
}
