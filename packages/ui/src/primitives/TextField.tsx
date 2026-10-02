import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Field, describedBy } from './Field';

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'children'> {
  label: ReactNode;
  hint?: ReactNode;
  /** Error text shown under the field; also sets `aria-invalid`. */
  error?: ReactNode;
}

export function TextField({
  label,
  hint,
  error,
  id,
  className,
  'aria-describedby': extra,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} hintId={hintId} errorId={errorId}>
      <input
        {...rest}
        id={inputId}
        className={cx('ac-input', className)}
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
