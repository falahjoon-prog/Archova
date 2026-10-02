-- OCR of scanned pages (Textract in Sydney) is logged and costed per page like any model call, and has no tier.
alter table ai.ai_requests drop constraint ai_requests_tier_check;
alter table ai.ai_requests add constraint ai_requests_tier_check
  check (tier in ('fast', 'standard', 'advanced', 'embedding', 'ocr'));
