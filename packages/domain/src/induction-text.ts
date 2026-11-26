// Wording shared by the ai and workforce modules. Lives here so workforce (and so the worker bundle) need not import
// the whole ai module for a constant.
/**
 * Fixed text from the reference table (compliance/08 §1.2: statutory and declaration wording never comes from the
 * model). Version 1 is Grace's draft in compliance/04 §2; the lawyer review (⚖) may change it, which bumps the
 * version recorded on each draft.
 */
export const INDUCTION_FIXED_TEXT = {
  version: 1,
  declaration:
    'I declare that the white card details I have given are true, that I have understood this induction, that I am fit for work and not impaired by fatigue, alcohol or drugs, and that I will follow the site rules.',
  swmsAwareness:
    "High-risk construction work needs an accepted SWMS before it starts. Opening a SWMS here doesn't replace signing on to it before you start the task.",
  disclaimer: 'Drafted by Nova from your project records. Check it before you use it.',
} as const;
