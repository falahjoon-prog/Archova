export const STATUS_TEXT: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  in_review: 'In review',
  approved: 'Approved',
  approved_as_noted: 'Approved as noted',
  revise_resubmit: 'Revise and resubmit',
  rejected: 'Rejected',
  closed: 'Closed',
};

export const TYPE_TEXT: Record<string, string> = {
  shop_drawing: 'Shop drawing',
  product_data: 'Product data',
  sample: 'Sample',
  mock_up: 'Mock-up',
  certificate: 'Certificate',
  other: 'Other',
};

export const ANSWER_TEXT = {
  approved: 'Approve',
  approved_as_noted: 'Approve as noted',
  revise_resubmit: 'Revise and resubmit',
  rejected: 'Reject',
  forwarded: 'Forward',
} as const;

export const statusLabel = (s: string) => STATUS_TEXT[s] ?? s;
export const typeLabel = (s: string) => TYPE_TEXT[s] ?? s;

const SIDE_TEXT = { subcontractor: 'subcontractor', builder: 'builder', consultant: 'consultant' };

/** "SD-014, Shop drawing, In review, with the consultant" */
export function submittalSubtitle(s: {
  numberLabel: string;
  type: string;
  status: string;
  ballInCourt: { side: string | null };
  submitByState: string;
}): string {
  const side = s.ballInCourt.side as keyof typeof SIDE_TEXT | null;
  return [
    s.numberLabel,
    typeLabel(s.type),
    statusLabel(s.status),
    side && SIDE_TEXT[side] ? `with the ${SIDE_TEXT[side]}` : null,
    s.submitByState === 'red'
      ? 'submit-by overdue'
      : s.submitByState === 'amber'
        ? 'submit-by passed'
        : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** The step that is waiting, on the latest revision, if any. */
export function waitingStep<
  R extends { steps: { id: string; response: string }[] },
  B extends { stepId: string | null },
>(revisions: readonly R[], ball: B): R['steps'][number] | null {
  if (!ball.stepId) return null;
  for (const r of revisions) {
    const step = r.steps.find((s) => s.id === ball.stepId && s.response === 'pending');
    if (step) return step;
  }
  return null;
}
