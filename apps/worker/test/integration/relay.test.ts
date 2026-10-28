import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { relayOnce } from '../../src/relay';
import { jobContext, loadEvent } from '../../src/subscribers';

const platformUrl = testAppUrl().replace('app_rw:app_rw', 'app_platform:app_platform');

let database: Database;
let platform: pg.Pool;
const orgA = uuidv7();
const orgB = uuidv7();

async function emit(orgId: string, type: string, data: unknown = {}) {
  await database.withTenantTx(jobContext(orgId, 't'), async (scope) => {
    scope.events.add({ type, entityType: 'thing', entityId: uuidv7(), data });
  });
}

beforeAll(async () => {
  database = createDatabase(testAppUrl());
  platform = new pg.Pool({ connectionString: platformUrl, max: 2 });
});

afterAll(async () => {
  await Promise.all([database.close(), platform.end()]);
});

describe('outbox relay', () => {
  it('relays unpublished events across tenants in order, once', async () => {
    await emit(orgA, 'x.thing.created.v1');
    await emit(orgB, 'x.thing.created.v1');
    await emit(orgA, 'x.thing.closed.v1');

    const seen: Array<{ orgId: string; type: string }> = [];
    const n = await relayOnce(platform, async (events) => {
      seen.push(...events.map((e) => ({ orgId: e.orgId, type: e.type })));
    });
    expect(n).toBe(3);
    expect(seen.map((e) => e.type)).toEqual([
      'x.thing.created.v1',
      'x.thing.created.v1',
      'x.thing.closed.v1',
    ]);
    expect(new Set(seen.map((e) => e.orgId))).toEqual(new Set([orgA, orgB]));

    expect(await relayOnce(platform, async () => {})).toBe(0);
  });

  it('leaves events unpublished when publishing fails, then retries them', async () => {
    await emit(orgA, 'x.thing.retry.v1');
    await expect(
      relayOnce(platform, async () => {
        throw new Error('queue down');
      }),
    ).rejects.toThrow('queue down');
    const ids: string[] = [];
    expect(await relayOnce(platform, async (e) => void ids.push(...e.map((x) => x.id)))).toBe(1);
    expect(ids).toHaveLength(1);
  });

  it('lets parallel relays take disjoint rows', async () => {
    for (let i = 0; i < 6; i++) await emit(orgA, 'x.thing.bulk.v1');
    const a: string[] = [];
    const b: string[] = [];
    await Promise.all([
      relayOnce(
        platform,
        async (e) => {
          a.push(...e.map((x) => x.id));
          await new Promise((r) => setTimeout(r, 150));
        },
        3,
      ),
      relayOnce(platform, async (e) => void b.push(...e.map((x) => x.id)), 3),
    ]);
    expect(a.length + b.length).toBe(6);
    expect(new Set([...a, ...b]).size).toBe(6);
  });

  it('subscribers read the full event as the tenant; other tenants cannot', async () => {
    await emit(orgA, 'x.thing.full.v1', { hello: 'world' });
    let id = '';
    await relayOnce(platform, async (e) => void (id = e[0]!.id));
    const ev = await loadEvent(database, orgA, id);
    expect(ev?.data).toEqual({ hello: 'world' });
    expect(ev?.type).toBe('x.thing.full.v1');
    expect(await loadEvent(database, orgB, id)).toBeNull();
  });
});

describe('app_platform grants', () => {
  it('cannot read payload columns, insert, delete, or touch other tables', async () => {
    await expect(platform.query('select data from shared.outbox limit 1')).rejects.toThrow(
      /permission denied/,
    );
    await expect(platform.query('select actor from shared.outbox limit 1')).rejects.toThrow(
      /permission denied/,
    );
    await expect(platform.query('select * from shared.outbox limit 1')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      platform.query(
        `insert into shared.outbox (id, org_id, type, entity_type, entity_id, actor, data) values ($1,$2,'x','x',$1,'{}','{}')`,
        [uuidv7(), orgA],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(platform.query('delete from shared.outbox')).rejects.toThrow(/permission denied/);
    await expect(platform.query('update shared.outbox set type = $1', ['hacked'])).rejects.toThrow(
      /permission denied/,
    );
    // Planning evaluates the tenant policy first, so a table with no grant may fail on app.org_id instead.
    await expect(platform.query('select 1 from shared.change_feed limit 1')).rejects.toThrow(
      /permission denied|app\.org_id/,
    );
    await expect(platform.query('select 1 from platform.memberships limit 1')).rejects.toThrow(
      /permission denied|app\.org_id/,
    );
  });

  it('cannot un-publish or edit published rows', async () => {
    await emit(orgA, 'x.thing.pub.v1');
    await relayOnce(platform, async () => {});
    const unpublish = await platform.query('update shared.outbox set published_at = null');
    expect(unpublish.rowCount).toBe(0);
    const { rows } = await platform.query(
      'select count(*)::int as n from shared.outbox where published_at is null',
    );
    expect(rows[0].n).toBe(0);
  });
});
