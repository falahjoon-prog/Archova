// Starting points for the notices an Australian builder sends most often (product/08 "Australian specifics",
// product/03). Each org copies the ones it wants into its own types and edits them. The notice periods are
// defaults to be confirmed against the actual contract, and the wording is for legal review before launch:
// Archova never asserts what a contract says (product/08).

export interface TypeTemplate {
  key: string;
  name: string;
  prefix: string;
  description: string;
  isEvidential: boolean;
  responseRequired: boolean;
  responseDays: number;
  /** Calendar days from the event, or null when the contract sets no bar for this notice. */
  timeBarDays: number | null;
  subjectTemplate: string;
  bodyTemplate: string;
}

const REF = 'Contract: [contract name and number]. Clause: [clause number]';

export const TYPE_TEMPLATES: readonly TypeTemplate[] = [
  {
    key: 'notice_of_delay',
    name: 'Notice of delay',
    prefix: 'NOD',
    description:
      'Written notice that a delay has occurred or is likely (AS 4000 cl 34 family). Confirm the notice period in your contract.',
    isEvidential: true,
    responseRequired: false,
    responseDays: 0,
    timeBarDays: 14,
    subjectTemplate: 'Notice of delay: [cause] ({{number}})',
    bodyTemplate: `{{date}}

To: [Superintendent / Principal]
Project: {{projectName}}
${REF}

NOTICE OF DELAY

We give notice under the Contract that the work under the Contract is being delayed.

Cause of delay: [describe the cause]
Date the delay began: {{eventDate}}
Activities affected: [activities / areas]
Expected effect on the date for practical completion: [days, or "to be advised"]

Supporting records: [diary entries, RFIs, photos, correspondence]

We will submit a claim for an extension of time within the period the Contract allows.`,
  },
  {
    key: 'eot_claim',
    name: 'Extension of time claim',
    prefix: 'EOT',
    description:
      'Formal claim for an extension of time following a notice of delay. Confirm the claim period in your contract.',
    isEvidential: true,
    responseRequired: true,
    responseDays: 14,
    timeBarDays: 28,
    subjectTemplate: 'Extension of time claim: [cause] ({{number}})',
    bodyTemplate: `{{date}}

To: [Superintendent]
Project: {{projectName}}
${REF}

CLAIM FOR EXTENSION OF TIME

Reference notice of delay: [number and date]
Cause and qualifying event: [describe the event and the clause it falls under]
Period of delay: from {{eventDate}} to [end date]
Days claimed: [number]
Effect on the critical path: [explain]

Attachments: [diary extracts, programme, RFIs, photos, correspondence]

We request that the date for practical completion be extended by the days claimed above.`,
  },
  {
    key: 'notice_of_variation',
    name: 'Notice of variation',
    prefix: 'NOV',
    description:
      'Notice that a direction or change is a variation to the work (AS 4000 cl 36 family), with an RFI or site instruction as its source.',
    isEvidential: true,
    responseRequired: true,
    responseDays: 7,
    timeBarDays: 14,
    subjectTemplate: 'Notice of variation: [description] ({{number}})',
    bodyTemplate: `{{date}}

To: [Superintendent / Principal]
Project: {{projectName}}
${REF}

NOTICE OF VARIATION

We give notice that the following direction or change is a variation to the work under the Contract.

Source: [RFI / site instruction / drawing revision, with number and date]
Description of the change: [describe]
Effect on cost: [amount, or "quotation to follow"]
Effect on time: [days, or "none"]

Please confirm the variation in writing.`,
  },
  {
    key: 'site_instruction',
    name: 'Site instruction',
    prefix: 'SI',
    description: 'A direction given on site, recorded in writing.',
    isEvidential: true,
    responseRequired: false,
    responseDays: 0,
    timeBarDays: null,
    subjectTemplate: 'Site instruction: [subject] ({{number}})',
    bodyTemplate: `{{date}}

To: [recipient company]
Project: {{projectName}}

SITE INSTRUCTION

Location: [level / area]
Instruction: [describe what is to be done]
Reason: [reason, with references to drawings, specifications or RFIs]

If you consider this instruction changes the scope or the time for the work, tell us in writing within [number] days so it can be assessed as a variation.`,
  },
  {
    key: 'notice_of_dispute',
    name: 'Notice of dispute',
    prefix: 'DSP',
    description:
      'Notice that a dispute has arisen (AS 4000 cl 42 family). Take legal advice before sending.',
    isEvidential: true,
    responseRequired: true,
    responseDays: 14,
    timeBarDays: null,
    subjectTemplate: 'Notice of dispute: [subject] ({{number}})',
    bodyTemplate: `{{date}}

To: [other party]
Project: {{projectName}}
${REF}

NOTICE OF DISPUTE

We give notice that a dispute has arisen under the Contract.

Nature of the dispute: [describe]
Date it arose: {{eventDate}}
Relevant records: [letters, claims, assessments]

We are willing to meet to resolve the dispute under the Contract's dispute resolution procedure.`,
  },
  {
    key: 'letter',
    name: 'General letter',
    prefix: 'LTR',
    description: 'Any other letter to a company on the project.',
    isEvidential: false,
    responseRequired: false,
    responseDays: 7,
    timeBarDays: null,
    subjectTemplate: '',
    bodyTemplate: `{{date}}

To: [recipient]
Project: {{projectName}}

[Write your letter here]`,
  },
];

export const findTemplate = (key: string) => TYPE_TEMPLATES.find((t) => t.key === key);
