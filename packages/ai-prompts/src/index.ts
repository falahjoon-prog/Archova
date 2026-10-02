// Versioned prompt templates and output schemas (ADR-0006), used only by the backend `ai` module.
// Never imported by clients (lint-enforced). Ari adds prompts from docs/ai/ in phase 1.

export interface PromptDefinition<TVars extends Record<string, string>> {
  id: string;
  version: number;
  /** Feature flag that gates the feature (`ai.<feature>`). */
  flag: `ai.${string}`;
  render(vars: TVars): { system: string; user: string };
}

export function definePrompt<TVars extends Record<string, string>>(def: PromptDefinition<TVars>) {
  if (!/^[a-z0-9_.-]+$/.test(def.id)) throw new Error(`Bad prompt id ${def.id}`);
  return def;
}
