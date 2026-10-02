import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Field, describedBy } from './Field';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  label: ReactNode;
  options: readonly SelectOption[];
  /** Adds a first, empty option (e.g. "Choose a company"). */
  placeholder?: string;
  hint?: ReactNode;
  error?: ReactNode;
}

export function Select({
  label,
  options,
  placeholder,
  hint,
  error,
  id,
  className,
  'aria-describedby': extra,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;
  return (
    <Field id={selectId} label={label} hint={hint} error={error} hintId={hintId} errorId={errorId}>
      <select
        {...rest}
        id={selectId}
        className={cx('ac-input', 'ac-select', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({
          hint: Boolean(hint) && hintId,
          error: Boolean(error) && errorId,
          extra,
        })}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
