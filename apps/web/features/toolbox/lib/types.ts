import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];

export type TopicCategory = S['ToolboxTopicCategory'];
export type TalkStatus = S['ToolboxTalkStatus'];
export type RepeatReason = S['ToolboxRepeatReason'];

export interface Topic {
  id: string;
  title: string;
  talkingPoints: string;
  category: TopicCategory;
  hrcwCategory: string | null;
  isActive: boolean;
  lastHeldAt: string | null;
  version: number;
}

export interface Talk {
  id: string;
  numberLabel: string;
  topicId: string | null;
  title: string;
  heldAt: string;
  location: string | null;
  presenterName: string;
  notes: string | null;
  status: TalkStatus;
  closedAt: string | null;
  attendeeCount: number;
  signedCount: number;
  version: number;
}

export interface Attendee {
  id: string;
  personName: string;
  companyId: string | null;
  signedAt: string | null;
  signatureFileId: string | null;
  repeatFlags: RepeatReason[];
}

export interface TalkDetail {
  talk: Talk;
  topic: Topic | null;
  attendees: Attendee[];
  closeBlockers: string[];
  canEdit: boolean;
}

export interface Suggestion {
  reason: S['ToolboxSuggestion']['reason'];
  topicId: string | null;
  title: string;
  because: string;
  hrcwCategory: string | null;
}

export interface TalkInput {
  title: string;
  topicId?: string;
  heldAt: string;
  presenterName: string;
  location?: string;
  attendees?: { personName: string; companyId?: string }[];
}

export interface TopicInput {
  title: string;
  talkingPoints?: string;
  category?: TopicCategory;
  hrcwCategory?: string | null;
}

export const CATEGORIES: readonly TopicCategory[] = [
  'general',
  'hazard',
  'plant',
  'environment',
  'wellbeing',
  'incident_review',
  'emergency',
];

export const CATEGORY_LABELS: Record<TopicCategory, string> = {
  general: 'General',
  hazard: 'Hazard',
  plant: 'Plant and equipment',
  environment: 'Environment',
  wellbeing: 'Health and wellbeing',
  incident_review: 'Incident review',
  emergency: 'Emergency',
};

export const STATUS_LABELS: Record<TalkStatus, string> = { open: 'Open', closed: 'Closed' };

export const REPEAT_LABELS: Record<RepeatReason, string> = {
  shared_between_people: 'Same signature as another person',
  reused_from_earlier_talk: 'Same image as an earlier talk',
};

export const REASON_LABELS: Record<Suggestion['reason'], string> = {
  recent_incident: 'Recent incident',
  swms_in_force: 'SWMS in force',
  not_run_recently: 'Not run lately',
  never_run: 'Not run yet',
};
