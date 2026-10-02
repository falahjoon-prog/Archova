import type { FlowStep, OpenedInduction } from '../lib/types';

export type OpenInduction = Extract<OpenedInduction, { state: 'open' }>;

export interface StepProps {
  opened: OpenInduction;
  go: (step: FlowStep) => void;
  online: boolean;
}
