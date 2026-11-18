// Who may see and decide an `ai_suggestions` row (ai/04 §7). `ai.suggestions.read` is held by every project member
// (tool null), so it only opens the list: each task that saves suggestions declares here the permission that decides
// its rows and who may see them, and a task that isn't declared is creator-only and can't be decided. A new task
// therefore starts closed and has to be opened on purpose. Pure, no IO.
import { drawingTitleBlockPrompt } from '@archova/ai-prompts';

/**
 * - `creator`: only the person who asked can list or decide the row. For drafts built from what they typed, photographed
 *   or uploaded, or from the lines they may read (a diary summary names the labour of every company its asker sees).
 *   Their forms are edited in place, so `edited` needs no fields.
 * - `deciders`: the creator, and anyone on the project who holds the task's decide permission. For drafts the team
 *   works through together, like a drawing register.
 */
export type SuggestionAudience = 'creator' | 'deciders';

export interface SuggestionTask {
  /** The permission to accept, edit or reject a row of this task (on top of `ai.suggestions.read`). */
  permission: string;
  audience: SuggestionAudience;
}

export const SUGGESTION_TASKS: Readonly<Record<string, SuggestionTask>> = {
  [drawingTitleBlockPrompt.id]: { permission: 'ai.drawing_register.extract', audience: 'deciders' },
  // F33: the builder approves or rejects the draft here; edits happen in the induction editor (ai/12 §2 I1).
  'induction.draft': { permission: 'ai.induction.draft', audience: 'deciders' },
  // F33 I2: the redraft of the sections a changed document touched; decided like the draft it refreshes.
  'induction.refresh': { permission: 'ai.induction.draft', audience: 'deciders' },
  // F4: whoever can write the diary takes or discards the summary draft it asked for.
  'diary.summary': { permission: 'diary.entries.write', audience: 'creator' },
  // F4: the weekly report; whoever can write the diary takes or discards it, and it is the asker's alone for the same reason.
  'diary.weekly': { permission: 'diary.entries.write', audience: 'creator' },
  // F7: the notes are the asker's until they add the items they want; whoever may write the minutes decides it.
  'minutes.extract': { permission: 'meetings.meetings.write', audience: 'creator' },
  // F5, F3: the person who asked for the tag or draft decides it; the photo, note or markup is theirs until they raise it.
  'defect.tag': { permission: 'defects.defects.create', audience: 'creator' },
  'rfi.draft': { permission: 'rfis.rfis.create', audience: 'creator' },
  // F20: the person who asked drafts a SWMS from what they know of the job; they edit it and submit it to the register.
  'swms.draft': { permission: 'safety.swms.submit', audience: 'creator' },
  // F3: the person who asked for the response decides it; their direction and the thread are theirs until they send it.
  'rfi.answer': { permission: 'rfis.rfis.respond', audience: 'creator' },
  // F34: the commercial team works a contract review together (design/09 CR3), so any member of the project holding the
  // review permission sees and decides it; the contract itself stays behind that permission.
  'contract.review': { permission: 'ai.contracts.review', audience: 'deciders' },
  // F31: the person who asked for the mapping confirms it; their file is theirs until they run the import.
  'import.mapping': { permission: 'ai.import_mapping.suggest', audience: 'creator' },
  // F22: the estimator who asked for the reading decides it (a subcontractor's prices are commercial in confidence).
  'quote.read': { permission: 'estimating.quotes.review', audience: 'creator' },
};

/** The permission that decides this task's rows, or undefined for a task nobody declared. */
export const decidePermission = (task: string): string | undefined =>
  SUGGESTION_TASKS[task]?.permission;

/** Undeclared tasks are creator-only. */
export const isCreatorOnly = (task: string): boolean =>
  SUGGESTION_TASKS[task]?.audience !== 'deciders';

/** Tasks whose rows other people may see when they hold the decide permission. */
export const DECIDER_TASKS: readonly string[] = Object.entries(SUGGESTION_TASKS)
  .filter(([, t]) => t.audience === 'deciders')
  .map(([task]) => task);

/**
 * May this person see a row someone created? `holds` says whether they hold a task's decide permission on the
 * project; it is only asked for `deciders` tasks.
 */
export async function maySee(
  row: { task: string; createdBy: string | null },
  userId: string,
  holds: (permission: string) => Promise<boolean>,
): Promise<boolean> {
  if (row.createdBy === userId) return true;
  const task = SUGGESTION_TASKS[row.task];
  return task?.audience === 'deciders' ? holds(task.permission) : false;
}
