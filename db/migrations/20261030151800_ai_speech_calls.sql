-- Composed from modules/ai/db/migrations/20261030151800_ai_speech_calls.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Speech to text (Nova listening, Australian provider) is logged and costed per clip like any model call, and has no tier.
alter table ai.ai_requests drop constraint ai_requests_tier_check;
alter table ai.ai_requests add constraint ai_requests_tier_check
  check (tier in ('fast', 'standard', 'advanced', 'embedding', 'ocr', 'speech'));
