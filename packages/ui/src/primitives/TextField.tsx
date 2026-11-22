import { useId, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cx } from '../lib/cx';
import { Field, describedBy } from './Field';

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'children'> {
  label: ReactNode;
  hint?: ReactNode;
  /** Error text shown under the field; also sets `aria-invalid`. */
  error?: ReactNode;
  /** Marks the value as filled by Nova until the user edits it (frontend 02 §7.2, inline fill). */
  aiFilled?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  aiFilled,
  id,
  className,
  'aria-describedby': extra,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const [revealed, setRevealed] = useState(false);
  // Password fields get a show/hide toggle so people can check what they typed (small screens, long passwords).
  const canReveal = rest.type === 'password' && !rest.disabled && !rest.readOnly;
  const input = (
    <input
      {...rest}
      type={canReveal && revealed ? 'text' : rest.type}
      id={inputId}
      className={cx(
        'ac-input',
        canReveal && 'ac-input--has-toggle',
        aiFilled && 'ac-input--ai',
        className,
      )}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy({
        hint: Boolean(hint) && hintId,
        error: Boolean(error) && errorId,
        extra,
      })}
    />
  );
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
      {canReveal ? (
        <div className="ac-input-wrap">
          {input}
          <button
            type="button"
            className="ac-input-toggle ac-focusable"
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
          </button>
        </div>
      ) : (
        input
      )}
    </Field>
  );
}
