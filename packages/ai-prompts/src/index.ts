// Versioned prompt templates and output schemas (ADR-0006, ai/03 §6), used only by the backend `ai` module.
export * from './core';
export * from './drawing-titleblock/prompt';
export * from './qa-answer/prompt';
export * from './induction-draft/prompt';
export * from './induction-ask/prompt';
export * from './translation/prompt';
export * from './qa-rewrite/prompt';
export * from './qa-rerank/prompt';
export * from './diary-summary/prompt';
export * from './rfi-draft/prompt';
export * from './drawing-compare/prompt';
export * from './defect-tag/prompt';
export * from './import-mapping/fields';
export * from './import-mapping/prompt';
