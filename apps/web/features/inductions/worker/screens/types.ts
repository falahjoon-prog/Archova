import type { FlowStep, OpenInduction } from '../lib/types';

export type { OpenInduction };

export interface StepProps {
  opened: OpenInduction;
  go: (step: FlowStep) => void;
  online: boolean;
}
