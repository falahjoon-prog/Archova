import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'children'> {
  label: ReactNode;
  hint?: ReactNode;
}

/** Native checkbox with a visible label; the whole row is the 44 px target. */
export function Checkbox({ label, hint, id, className, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cx('ac-check', className)}>
      <input
        {...rest}
        id={inputId}
        type="checkbox"
        className="ac-check__input"
        aria-describedby={hint ? hintId : undefined}
      />
      <label htmlFor={inputId} className="ac-check__label">
        {label}
        {hint ? (
          <span id={hintId} className="ac-field__hint">
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}

export interface SwitchProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'onChange' | 'children'
> {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** On/off toggle (`role="switch"`), for settings that apply at once, e.g. "Normalise" or "Site stood down". */
export function Switch({ label, checked, onCheckedChange, id, className, ...rest }: SwitchProps) {
  const autoId = useId();
  const buttonId = id ?? autoId;
  return (
    <div className={cx('ac-switch', className)}>
      <button
        {...rest}
        id={buttonId}
        type="button"
        role="switch"
        aria-checked={checked}
        className="ac-switch__track ac-focusable"
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="ac-switch__thumb" aria-hidden="true" />
      </button>
      <label htmlFor={buttonId} className="ac-switch__label">
        {label}
      </label>
    </div>
  );
}
