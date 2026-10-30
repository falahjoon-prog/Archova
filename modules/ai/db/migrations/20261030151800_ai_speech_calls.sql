-- Speech to text (Nova listening, Australian provider) is logged and costed per clip like any model call, and has no tier.
alter table ai.ai_requests drop constraint ai_requests_tier_check;
alter table ai.ai_requests add constraint ai_requests_tier_check
  check (tier in ('fast', 'standard', 'advanced', 'embedding', 'ocr', 'speech'));
