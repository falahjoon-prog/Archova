// Toolbox talks data source, mirroring `{p}/toolbox-topics`, `{p}/toolbox-talks` and the attendance grid (safety module).
// Preview: in-memory store with the same rules as the server (a closed talk is frozen, a signed row can't be removed).

import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import type {
  Suggestion,
  Talk,
  TalkDetail,
  TalkInput,
  Topic,
  TopicInput,
  Attendee,
} from '../lib/types';

export interface ToolboxSource {
  listTalks(projectId: string): Promise<Talk[]>;
  getTalk(projectId: string, id: string): Promise<TalkDetail>;
  createTalk(projectId: string, input: TalkInput): Promise<TalkDetail>;
  transition(projectId: string, d: TalkDetail, action: 'close' | 'reopen'): Promise<TalkDetail>;
  addAttendees(
    projectId: string,
    d: TalkDetail,
    people: { personName: string; companyId?: string }[],
  ): Promise<TalkDetail>;
  removeAttendee(projectId: string, d: TalkDetail, attendeeId: string): Promise<TalkDetail>;
  /** Signs one row; `image` is the drawn (or typed) signature rendered as a PNG. */
  sign(projectId: string, d: TalkDetail, attendeeId: string, image: Blob): Promise<TalkDetail>;
  clearSignature(projectId: string, d: TalkDetail, attendeeId: string): Promise<TalkDetail>;
  listTopics(projectId: string): Promise<Topic[]>;
  createTopic(projectId: string, input: TopicInput): Promise<Topic>;
  setTopicActive(projectId: string, topic: Topic, isActive: boolean): Promise<Topic>;
  suggestions(projectId: string): Promise<Suggestion[]>;
}

interface Store {
  talks: TalkDetail[];
  topics: Topic[];
  next: number;
}

const label = (n: number) => `TBT-${String(n).padStart(4, '0')}`;

const seed = (): Store => {
  const topics: Topic[] = [
    {
      id: 'tbp_0001',
      title: 'Working at heights',
      talkingPoints: 'Edges, harnesses and ladders.',
      category: 'hazard',
      hrcwCategory: 'fall_2m',
      isActive: true,
      lastHeldAt: '2026-10-20T21:00:00Z',
      version: 1,
    },
    {
      id: 'tbp_0002',
      title: 'Manual handling',
      talkingPoints: 'Plan the lift, ask for help, keep the load close.',
      category: 'general',
      hrcwCategory: null,
      isActive: true,
      lastHeldAt: null,
      version: 1,
    },
  ];
  const attendees: Attendee[] = [
    {
      id: 'tba_0001',
      personName: 'Sam Carpenter',
      companyId: null,
      signedAt: '2026-10-20T21:05:00Z',
      signatureFileId: 'fil_0001',
      repeatFlags: [],
    },
    {
      id: 'tba_0002',
      personName: 'Lee Rigger',
      companyId: null,
      signedAt: null,
      signatureFileId: null,
      repeatFlags: [],
    },
  ];
  return {
    topics,
    next: 2,
    talks: [
      {
        talk: {
          id: 'tbt_0001',
          numberLabel: label(1),
          topicId: 'tbp_0001',
          title: 'Working at heights',
          heldAt: '2026-10-20T21:00:00Z',
          location: 'Level 3',
          presenterName: 'Pat Foreman',
          notes: null,
          status: 'open',
          closedAt: null,
          attendeeCount: 2,
          signedCount: 1,
          version: 1,
        },
        topic: topics[0]!,
        attendees,
        closeBlockers: ['1 person has not signed. Sign, or remove them.'],
        canEdit: true,
      },
    ],
  };
};

const stores = projectStores<Store>(seed);
export const resetToolboxPreview = () => {
  stores.reset();
};

/** Recomputes the counts and close blockers after any change, as the server does. */
function settle(s: Store, d: TalkDetail): TalkDetail {
  const signed = d.attendees.filter((a) => a.signedAt).length;
  const unsigned = d.attendees.length - signed;
  const next: TalkDetail = {
    ...d,
    talk: {
      ...d.talk,
      attendeeCount: d.attendees.length,
      signedCount: signed,
      version: d.talk.version + 1,
    },
    closeBlockers:
      d.talk.status === 'closed'
        ? []
        : d.attendees.length === 0
          ? ['Add the people who attended.']
          : unsigned > 0
            ? [
                `${unsigned} ${unsigned === 1 ? 'person has' : 'people have'} not signed. Sign, or remove them.`,
              ]
            : [],
  };
  s.talks = s.talks.map((t) => (t.talk.id === d.talk.id ? next : t));
  return next;
}

function current(s: Store, id: string) {
  const d = s.talks.find((t) => t.talk.id === id);
  if (!d) problem(404, 'toolbox.not_found', 'Toolbox talk not found.');
  return d;
}

function open(s: Store, id: string) {
  const d = current(s, id);
  if (d.talk.status === 'closed') problem(409, 'toolbox.closed', 'This talk is closed.');
  return structuredClone(d);
}

export const toolboxPreview: ToolboxSource = {
  async listTalks(projectId) {
    return delay(stores.get(projectId).talks.map((t) => t.talk));
  },
  async getTalk(projectId, id) {
    return delay(current(stores.get(projectId), id));
  },
  async createTalk(projectId, input) {
    const s = stores.get(projectId);
    s.next += 1;
    const topic = s.topics.find((t) => t.id === input.topicId) ?? null;
    const d: TalkDetail = {
      talk: {
        id: mockId('tbt'),
        numberLabel: label(s.next),
        topicId: topic?.id ?? null,
        title: input.title,
        heldAt: input.heldAt,
        location: input.location ?? null,
        presenterName: input.presenterName,
        notes: null,
        status: 'open',
        closedAt: null,
        attendeeCount: 0,
        signedCount: 0,
        version: 1,
      },
      topic,
      attendees: (input.attendees ?? []).map((p) => ({
        id: mockId('tba'),
        personName: p.personName,
        companyId: p.companyId ?? null,
        signedAt: null,
        signatureFileId: null,
        repeatFlags: [],
      })),
      closeBlockers: [],
      canEdit: true,
    };
    s.talks = [d, ...s.talks];
    if (topic) topic.lastHeldAt = input.heldAt;
    return delay(settle(s, d));
  },
  async transition(projectId, d, action) {
    const s = stores.get(projectId);
    const cur = structuredClone(current(s, d.talk.id));
    if (action === 'close') {
      const blockers = settle(s, cur).closeBlockers;
      if (blockers.length) problem(422, 'toolbox.cannot_close', blockers[0]!);
      cur.talk.status = 'closed';
      cur.talk.closedAt = nowIso();
    } else {
      cur.talk.status = 'open';
      cur.talk.closedAt = null;
    }
    return delay(settle(s, cur));
  },
  async addAttendees(projectId, d, people) {
    const s = stores.get(projectId);
    const cur = open(s, d.talk.id);
    for (const p of people) {
      if (
        cur.attendees.some((a) => a.personName.toLowerCase() === p.personName.trim().toLowerCase())
      )
        problem(409, 'toolbox.already_listed', `${p.personName} is already on this talk.`);
      cur.attendees.push({
        id: mockId('tba'),
        personName: p.personName.trim(),
        companyId: p.companyId ?? null,
        signedAt: null,
        signatureFileId: null,
        repeatFlags: [],
      });
    }
    return delay(settle(s, cur));
  },
  async removeAttendee(projectId, d, attendeeId) {
    const s = stores.get(projectId);
    const cur = open(s, d.talk.id);
    if (cur.attendees.find((a) => a.id === attendeeId)?.signedAt)
      problem(409, 'toolbox.has_signatures', 'Clear the signature first.');
    cur.attendees = cur.attendees.filter((a) => a.id !== attendeeId);
    return delay(settle(s, cur));
  },
  async sign(projectId, d, attendeeId) {
    const s = stores.get(projectId);
    const cur = open(s, d.talk.id);
    const a = cur.attendees.find((x) => x.id === attendeeId);
    if (!a) problem(404, 'toolbox.attendee_not_found', 'Row not found.');
    if (a.signedAt) problem(409, 'toolbox.already_signed', 'Already signed.');
    a.signedAt = nowIso();
    a.signatureFileId = mockId('fil');
    return delay(settle(s, cur));
  },
  async clearSignature(projectId, d, attendeeId) {
    const s = stores.get(projectId);
    const cur = open(s, d.talk.id);
    const a = cur.attendees.find((x) => x.id === attendeeId);
    if (!a?.signedAt) problem(409, 'toolbox.not_signed', 'Not signed.');
    a.signedAt = null;
    a.signatureFileId = null;
    return delay(settle(s, cur));
  },
  async listTopics(projectId) {
    return delay(stores.get(projectId).topics);
  },
  async createTopic(projectId, input) {
    const s = stores.get(projectId);
    const t: Topic = {
      id: mockId('tbp'),
      title: input.title,
      talkingPoints: input.talkingPoints ?? '',
      category: input.category ?? 'general',
      hrcwCategory: input.hrcwCategory ?? null,
      isActive: true,
      lastHeldAt: null,
      version: 1,
    };
    s.topics.push(t);
    return delay(t);
  },
  async setTopicActive(projectId, topic, isActive) {
    const t = stores.get(projectId).topics.find((x) => x.id === topic.id);
    if (!t) problem(404, 'toolbox.topic_not_found', 'Topic not found.');
    t.isActive = isActive;
    return delay(t);
  },
  async suggestions(projectId) {
    const s = stores.get(projectId);
    return delay(
      s.topics
        .filter((t) => t.isActive && !t.lastHeldAt)
        .map<Suggestion>((t) => ({
          reason: 'never_run',
          topicId: t.id,
          title: t.title,
          because: 'In your topic library and not run on this project yet.',
          hrcwCategory: t.hrcwCategory,
        })),
    );
  },
};
