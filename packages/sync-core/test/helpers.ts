import { uuidv7 } from '@archova/domain';
import { SyncEngine, projectScope, type SyncEngineOptions, type SyncScope } from '../src';
import { FakeSyncServer, MemorySyncStore } from '../src/testing';

export const PROJECT_A = 'prj_a';
export const PROJECT_B = 'prj_b';

export const COMMANDS = {
  'defects.create': { entityType: 'defect', module: 'defects', kind: 'create' },
  'defects.update': { entityType: 'defect', module: 'defects', kind: 'update' },
  'defects.delete': { entityType: 'defect', module: 'defects', kind: 'delete' },
  'photos.create': { entityType: 'photo', module: 'photos', kind: 'append' },
  'diary.addLabour': { entityType: 'diary_labour', module: 'diary', kind: 'append' },
} as const;

const MODULE_OF: Record<string, string> = {
  defect: 'defects',
  photo: 'photos',
  diary_labour: 'diary',
};

export class FakeClock {
  constructor(public ms = Date.parse('2026-10-02T09:00:00Z')) {}
  now = () => this.ms;
  advance(ms: number) {
    this.ms += ms;
  }
  iso() {
    return new Date(this.ms).toISOString();
  }
}

export function setup(options: { scopes?: SyncScope[]; engine?: Partial<SyncEngineOptions> } = {}) {
  const server = new FakeSyncServer({ ...COMMANDS });
  const store = new MemorySyncStore({ moduleOf: (t) => MODULE_OF[t] ?? t });
  const clock = new FakeClock();
  let scopes = options.scopes ?? [
    projectScope(PROJECT_A, 'defects'),
    projectScope(PROJECT_A, 'photos'),
    projectScope(PROJECT_A, 'diary'),
  ];
  const engine = new SyncEngine({
    store,
    transport: server.transport(),
    scopes: () => scopes,
    clock,
    random: () => 0.5,
    ...options.engine,
  });
  return {
    server,
    store,
    clock,
    engine,
    setScopes(next: SyncScope[]) {
      scopes = next;
    },
  };
}

/** A feature-style offline write: optimistic record plus outbox entry. */
export function createDefect(
  store: MemorySyncStore,
  clock: FakeClock,
  fields: { title: string; projectId?: string; id?: string },
) {
  const id = fields.id ?? uuidv7(clock.now());
  const data = { projectId: fields.projectId ?? PROJECT_A, title: fields.title };
  return store.write(
    { entityType: 'defect', id, data },
    {
      mutationId: uuidv7(clock.now()),
      command: 'defects.create',
      projectId: data.projectId,
      baseVersion: null,
      clientAt: clock.iso(),
      payload: data,
      dependsOn: [],
    },
  );
}

export function updateDefect(
  store: MemorySyncStore,
  clock: FakeClock,
  id: string,
  fields: Record<string, unknown>,
) {
  const record = store.get('defect', id);
  const data = { ...(record?.data as object), ...fields };
  const projectId = (data as { projectId: string }).projectId;
  return store.write(
    { entityType: 'defect', id, data },
    {
      mutationId: uuidv7(clock.now()),
      command: 'defects.update',
      projectId,
      baseVersion: record?.version ?? null,
      clientAt: clock.iso(),
      payload: { projectId, ...fields },
      dependsOn: [],
    },
  );
}

export function addPhoto(
  store: MemorySyncStore,
  clock: FakeClock,
  defectId: string,
  dependsOn: string[] = [],
) {
  const id = uuidv7(clock.now());
  const data = { projectId: PROJECT_A, defectId };
  return store.write(
    { entityType: 'photo', id, data },
    {
      mutationId: uuidv7(clock.now()),
      command: 'photos.create',
      projectId: PROJECT_A,
      baseVersion: null,
      clientAt: clock.iso(),
      payload: data,
      dependsOn,
    },
  );
}
