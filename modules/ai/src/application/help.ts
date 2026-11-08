// Nova help (ai/07): "where do I find …" and "what does this error mean". Reads no project records and writes
// nothing but the usual run accounting, so there is no suggestion row to keep: the answer goes straight back.
import { helpExplainPrompt, type HelpExplainInput } from '@archova/ai-prompts';
import { AppError, type TenantContext } from '@archova/kernel';
import { reviewHelp, type ReviewedHelp } from '../domain/help';
import type { Gateway } from './gateway';

export interface HelpDeps {
  gateway: Pick<Gateway, 'runTask'>;
}

export interface HelpAnswer extends ReviewedHelp {
  runId: string;
}

export function createHelpService(deps: HelpDeps) {
  async function explain(
    ctx: TenantContext,
    input: HelpExplainInput,
    signal?: AbortSignal,
  ): Promise<HelpAnswer> {
    if (!input.question?.trim() && !input.error)
      throw new AppError('validation_failed', 'Ask a question or pass the error to explain.');
    const run = await deps.gateway.runTask(
      ctx,
      helpExplainPrompt,
      { ...input, question: input.question?.trim() || null },
      signal ? { signal } : {},
    );
    if (run.status !== 'ok')
      throw new AppError('ai.invalid_output', "Nova couldn't answer that. Try again.");
    return { runId: run.runId, ...reviewHelp(run.output) };
  }
  return { explain };
}

export type HelpService = ReturnType<typeof createHelpService>;
