import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@archova/domain';
import { createDatabase, createLogger, type Database } from '@archova/kernel';
import { testAppUrl, testRedisUrl } from '@archova/testing';
import { loadAiWorkerConfig } from '../../src/ai/config';
import { loadAiWorkerModules, reindexDepsFrom } from '../../src/ai/modules';
import { createReindex, REINDEX_JOB, type ReindexJob } from '../../src/ai/reindex';
import { connectionFor } from '../../src/queues';
import { jobContext, type StoredEvent } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

async function insertOrg() {
  const id = uuidv7();
  await database.withTenantTx(jobContext(id, 't'), (s) =>
    s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${id}, ${'Org ' + id}, ${'org-' + id})`,
    ),
  );
  return id;
}

const config = () => loadAiWorkerConfig({ DATABASE_URL: testAppUrl(), REDIS_URL: 'redis://x' });

describe("the ai-worker's modules", () => {
  it("load from the worker's own settings, and answer the questions the job asks", async () => {
    const modules = await loadAiWorkerModules(database, createLogger('test'), config());
    const deps = reindexDepsFrom(database, modules);
    const org = await insertOrg();

    expect(await deps.orgExists(org)).toBe(true);
    expect(await deps.orgExists(uuidv7())).toBe(false);
    expect((await deps.entitlementsFor(org)).modules).toContain('ai');

    // A record that is not there (or is in another org) is not a source, and dropping it harms nothing.
    const ctx = jobContext(org, 't');
    expect(await deps.ai.dropStaleRecord(ctx, uuidv7(), 'defect', uuidv7())).toEqual({
      isSource: false,
    });
    expect(await deps.ai.dropStaleRecord(ctx, uuidv7(), 'rfi', uuidv7())).toEqual({
      isSource: false,
    });
    expect(await deps.ai.dropStaleRecord(ctx, uuidv7(), 'diary', uuidv7())).toEqual({
      isSource: false,
    });
  });

  it('read the AI settings the way the API does: a non-Australian region is refused at start', () => {
    expect(() =>
      loadAiWorkerConfig({
        DATABASE_URL: 'postgres://x',
        REDIS_URL: 'redis://x',
        API_AI_PROVIDER: 'bedrock',
        API_AI_REGION: 'us-east-1',
      }),
    ).toThrow();
  });
});

const redisUrl = testRedisUrl();

describe.runIf(redisUrl)('the re-index queue', () => {
  const prefix = `t${Date.now()}`;
  const queue = new Queue<ReindexJob>('ai-reindex', {
    connection: connectionFor(redisUrl!),
    prefix,
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  const change = (id: string, recordId: string): StoredEvent => ({
    id,
    orgId: uuidv7(),
    type: 'rfis.rfi.responded.v1',
    projectId: uuidv7(),
    entityType: 'rfi',
    entityId: recordId,
    entityVersion: 1,
    actor: null,
    data: {},
    traceId: null,
    occurredAt: new Date().toISOString(),
  });

  it('holds one delayed job per record per window, however many events arrive', async () => {
    const orgId = uuidv7();
    const projectId = uuidv7();
    const record = uuidv7();
    const other = uuidv7();
    const reindex = createReindex({
      ai: {
        dropStaleRecord: async () => ({ isSource: true }),
        reindexRecord: async () => ({ indexed: 0, unchanged: 0 }),
      },
      entitlementsFor: async () => {
        throw new Error('not asked at this stage');
      },
      orgExists: async () => true,
      queue,
      log: () => {},
    });
    const send = (id: string, recordId: string) =>
      reindex.subscriber.handle({ ...change(id, recordId), orgId, projectId }, { database });

    for (let i = 0; i < 5; i++) await send(`e${i}`, record);
    // Redelivery of one of them changes nothing either.
    await send('e0', record);
    await send('e-other', other);

    expect(await queue.getJobCountByTypes('delayed')).toBe(2);
    const jobs = await queue.getDelayed();
    expect(jobs.map((j) => j.name)).toEqual([REINDEX_JOB, REINDEX_JOB]);
    expect(jobs.map((j) => j.data.recordId).sort()).toEqual([record, other].sort());
    expect(jobs.every((j) => j.data.orgId === orgId && j.data.kind === 'rfi')).toBe(true);
  });
});
