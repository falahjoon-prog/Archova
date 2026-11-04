import type { ContractReview, ReviewFlag } from '../data/api';

export const DISCLAIMER =
  'Nova reads the contract and points to where it differs from your playbook. It is not legal advice.';
export const WORDING_LABEL = 'Draft wording, not legal advice';

const wording = {
  title: 'Security release',
  wording: 'Half of the security is released at practical completion.',
  approvedBy: 'Priya Shah',
  approvedOn: '2026-08-01',
  label: WORDING_LABEL,
  approvalNote: 'Approver as recorded by an org admin, not checked by Archova.',
};

export const flag = (over: Partial<ReviewFlag> = {}): ReviewFlag => ({
  topicKey: 'ld_cap',
  topic: 'Liquidated damages cap',
  severity: 'high',
  finding: 'Liquidated damages are uncapped.',
  source: { page: 12, clause: '34.2', quote: 'Liquidated damages are payable at $5,000 per day.' },
  position: 'Cap at 10% of the contract sum',
  threshold: '10%',
  approvedWording: wording,
  wordingStatus: 'offered',
  ...over,
});

export const review = (over: Partial<ContractReview> = {}): ContractReview => ({
  createdAt: '2026-10-20T01:00:00Z',
  decisions: [],
  runId: 'air_1',
  suggestionId: 'ais_1',
  disclaimer: DISCLAIMER,
  fileId: 'fil_1',
  fileName: 'Head contract.pdf',
  contractType: 'head_contract',
  ourSide: 'we_pay',
  baseForm: 'as4000',
  multiState: false,
  playbookMissing: false,
  playbookTopics: 3,
  pageCount: 40,
  unreadPages: [],
  truncated: false,
  summary: [
    {
      key: 'contract_sum',
      text: 'Contract sum is $2,000,000.',
      source: { page: 3, clause: '5', quote: 'The contract sum is $2,000,000.' },
    },
  ],
  summaryNotFound: ['insurance'],
  timeBars: [],
  flags: [
    flag(),
    flag({
      topicKey: 'security',
      topic: 'Security release',
      severity: 'medium',
      finding: 'Security is held until the end of defects.',
      source: {
        page: 9,
        clause: '18.1',
        quote: 'Security is held until the end of the defects period.',
      },
      approvedWording: null,
      wordingStatus: 'none',
    }),
    flag({
      topicKey: 'eot',
      topic: 'Extension of time notice',
      severity: 'low',
      finding: 'Notice of delay is 5 days.',
      source: { page: 15, clause: '36', quote: 'Notice within 5 days.' },
      approvedWording: null,
      wordingStatus: 'none',
    }),
  ],
  dropped: { notOnPage: 0, bannedWords: 0, unknownTopic: 0 },
  ...over,
});

export const decision = (
  flagIndex: number,
  kind: ContractReview['decisions'][number]['decision'],
) => ({
  flagIndex,
  decision: kind,
  note: null,
  decidedBy: 'usr_me',
  decidedAt: '2026-10-21T01:00:00Z',
});
