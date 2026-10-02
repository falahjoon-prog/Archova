import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';

/** Shared label / hint / error frame for form controls. `describedBy` is computed by the caller. */
export function Field({
  id,
  label,
  hint,
  error,
  hintId,
  errorId,
  aiFilled,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  hintId: string;
  errorId: string;
  /** Shows the Nova marker next to the label (design 02 §7.7: users always know when content came from AI). */
  aiFilled?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="ac-field">
      <label className="ac-field__label" htmlFor={id}>
        {label}
        {aiFilled ? (
          <span className="ac-field__ai">
            <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
            Drafted by Nova
          </span>
        ) : null}
      </label>
      {hint ? (
        <p className="ac-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="ac-field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(ids: {
  hint: string | false;
  error: string | false;
  extra?: string | undefined;
}): string | undefined {
  const all = [ids.extra, ids.hint, ids.error].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  return all.length ? all.join(' ') : undefined;
}
