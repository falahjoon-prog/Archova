import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  /** One sentence (design 02 §7.4: icon, one sentence, one action). */
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="ac-empty">
      {Icon ? (
        <Icon size={24} strokeWidth={1.5} aria-hidden="true" className="ac-empty__icon" />
      ) : null}
      <p className="ac-empty__title">{title}</p>
      {description ? <p className="ac-empty__description">{description}</p> : null}
      {action ? <div className="ac-empty__action">{action}</div> : null}
    </div>
  );
}
