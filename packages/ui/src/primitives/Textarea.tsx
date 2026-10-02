import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Field, describedBy } from './Field';

export interface TextareaProps extends Omit<ComponentPropsWithRef<'textarea'>, 'children'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Marks the value as filled by Nova until the user edits it (frontend 02 §7.2, inline fill). */
  aiFilled?: boolean;
}

export function Textarea({
  label,
  hint,
  error,
  aiFilled,
  id,
  className,
  rows = 4,
  'aria-describedby': extra,
  ...rest
}: TextareaProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  return (
    <Field
      id={inputId}
      label={label}
      hint={hint}
      error={error}
      hintId={hintId}
      errorId={errorId}
      aiFilled={aiFilled}
    >
      <textarea
        {...rest}
        id={inputId}
        rows={rows}
        className={cx('ac-input', 'ac-textarea', aiFilled && 'ac-input--ai', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({
          hint: Boolean(hint) && hintId,
          error: Boolean(error) && errorId,
          extra,
        })}
      />
    </Field>
  );
}
