// Starter questions and quick actions for the Ask Nova panel (Sitetracker-style "Ask me things like"). They are plain
// rules over what the current screen published (how many items are open or overdue): no model call, so they cost
// nothing and appear instantly. Nothing is invented: a count of zero produces no chip about it.
import { webRoutes } from '@archova/routes';
import type { AssistantScope } from '../components/AssistantScope';

export interface QuickAction {
  key: string;
  label: string;
  href: string;
}

export interface Starters {
  questions: string[];
  actions: QuickAction[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Starters for the screen's scope; empty questions mean the panel falls back to its general ones. */
export function startersFor(scope: AssistantScope, orgSlug: string): Starters {
  const projectId = scope.projectId;
  const type = scope.record?.type;
  const c = scope.counts ?? {};
  const questions: string[] = [];
  const actions: QuickAction[] = [];
  if (!projectId) return { questions, actions };

  if (type === 'rfis') {
    if (c.overdue)
      questions.push(
        `Which ${plural(c.overdue, 'RFI is', 'RFIs are')} overdue and who holds the ball?`,
      );
    if (c.open) questions.push('Which open RFIs could hold up work on site?');
    questions.push('Which RFIs have cost or time impact?');
    actions.push({ key: 'new-rfi', label: 'New RFI', href: webRoutes.newRfi(orgSlug, projectId) });
  } else if (type === 'defects') {
    if (c.overdue)
      questions.push(`Which ${plural(c.overdue, 'defect is', 'defects are')} overdue?`);
    if (c.review) questions.push('Which defects are ready for me to inspect?');
    if (c.open) questions.push('Which trades have the most open defects?');
    actions.push({
      key: 'new-defect',
      label: 'New defect',
      href: webRoutes.newDefect(orgSlug, projectId),
    });
  } else if (type === 'rfi') {
    questions.push('Summarise this RFI and what is needed next.');
  } else if (type === 'defect') {
    questions.push('What is needed to close this defect?');
  }
  return { questions: questions.slice(0, 3), actions };
}
