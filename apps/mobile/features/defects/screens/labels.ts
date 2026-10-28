import type { DefectAction, DefectStage, DefectStatus } from '@archova/domain';

export const statusLabel: Record<DefectStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  ready_for_review: 'Ready for inspection',
  closed: 'Closed',
  disputed: 'Disputed',
  void: 'Void',
};

export const actionLabel: Record<DefectAction, string> = {
  issue: 'Issue to company',
  markReadyForReview: 'Ready for inspection',
  close: 'Close',
  reject: 'Reject',
  dispute: 'Not ours',
  reassign: 'Reassign',
  void: 'Void',
};

export const stageLabel: Record<DefectStage, string> = {
  pre_pc: 'Before PC',
  pc: 'PC',
  dlp: 'DLP',
};
