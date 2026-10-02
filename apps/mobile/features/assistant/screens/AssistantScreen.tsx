import { Placeholder } from '../../../shared';

/**
 * The Ask Nova screen slot (X27, X29; ai/07 §2), opened from the header button on every tab.
 * The conversation UI arrives with the `ai` module in phase 1.
 */
export function AssistantScreen({ projectId }: { projectId?: string }) {
  return (
    <Placeholder
      title="Ask Nova"
      description={`Nova isn't switched on yet. Soon you'll be able to ask about ${
        projectId ? 'this project' : 'your projects'
      } and get answers with links to the source.`}
    />
  );
}
