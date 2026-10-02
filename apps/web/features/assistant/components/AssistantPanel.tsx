'use client';

import { useAssistantScope } from './AssistantScope';

/**
 * The Ask Nova panel slot (X27, X29; ai/07 §2). Phase 0 reserves its place in the app shell and the scope
 * plumbing; the conversation UI arrives with the `ai` module in phase 1.
 */
export function AssistantPanel() {
  const scope = useAssistantScope();
  return (
    <div className="assistant-panel">
      <h2 className="assistant-panel__title">Ask Nova</h2>
      <p className="assistant-panel__body">
        Nova isn&apos;t switched on yet. Soon you&apos;ll be able to ask about{' '}
        {scope.projectId ? 'this project' : 'your projects'} and get answers with links to the
        source.
      </p>
    </div>
  );
}
