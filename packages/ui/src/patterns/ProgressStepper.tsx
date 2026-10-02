import { Check, CloudOff } from 'lucide-react';

export type SaveState = 'saved' | 'saving' | 'offline' | null;

export interface ProgressStepperProps {
  /** 1-based. */
  current: number;
  total: number;
  /** What the steps are, for the bar's name: "Induction progress". */
  label: string;
  /** Shown beside the count so people trust that nothing is lost (design 08 B3). */
  saveState?: SaveState;
}

/**
 * Worker progress (design 02 §7.10, design 08 Part B): "Step x of y" with a bar, announced politely when it
 * changes, and a small save indicator. Text and icon, never colour alone.
 */
export function ProgressStepper({ current, total, label, saveState = null }: ProgressStepperProps) {
  const clamped = Math.min(Math.max(current, 0), total);
  return (
    <div className="ac-stepper">
      <div className="ac-stepper__row">
        <p className="ac-stepper__count" aria-live="polite">
          Step {clamped} of {total}
        </p>
        {saveState === 'saved' ? (
          <p className="ac-stepper__save">
            <Check size={14} strokeWidth={2} aria-hidden="true" /> Saved
          </p>
        ) : saveState === 'saving' ? (
          <p className="ac-stepper__save">Saving…</p>
        ) : saveState === 'offline' ? (
          <p className="ac-stepper__save ac-stepper__save--offline">
            <CloudOff size={14} strokeWidth={2} aria-hidden="true" /> Offline
          </p>
        ) : null}
      </div>
      <div
        className="ac-stepper__bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={clamped}
        aria-valuetext={`Step ${clamped} of ${total}`}
      >
        <span style={{ width: `${total ? (clamped / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}
