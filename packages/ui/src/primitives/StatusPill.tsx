import type { ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Circle, Info } from 'lucide-react';
import { NovaMark } from '../icons/NovaMark';
import { cx } from '../lib/cx';

/** Status families (design 02 §2.2). `ai` is only for Nova content (§2.3). */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'ai';

const ICONS = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertOctagon,
  info: Info,
  neutral: Circle,
  ai: NovaMark,
} as const;

export interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}

/** Badge / status pill: colour always comes with an icon and a text label (accessibility rule A3). */
export function StatusPill({ tone, children, className }: StatusPillProps) {
  const Icon = ICONS[tone];
  return (
    <span className={cx('ac-pill', `ac-pill--${tone}`, className)}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** Neutral count or label badge (e.g. sidebar "assigned to me" counts). */
export function Badge({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <span className="ac-badge" aria-label={label}>
      {children}
    </span>
  );
}
