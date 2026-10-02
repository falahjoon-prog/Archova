import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { projectPeople, resetProjectPeople } = await import('../people');

const MEMBERS = '/v1/orgs/{orgId}/projects/{projectId}/members';

beforeEach(() => {
  fake.reset();
  resetProjectPeople();
});

describe('projectPeople', () => {
  it('maps user ids to names across pages and fetches once per project', async () => {
    fake.on('GET', MEMBERS, (init) =>
      init.params?.query?.cursor
        ? { data: [{ userId: 'usr_2', name: 'Priya Singh' }], nextCursor: null }
        : { data: [{ userId: 'usr_1', name: 'Alex Chen' }], nextCursor: 'c2' },
    );
    const people = await projectPeople('org_1', 'prj_1');
    expect(people.get('usr_1')).toBe('Alex Chen');
    expect(people.get('usr_2')).toBe('Priya Singh');
    await projectPeople('org_1', 'prj_1');
    expect(fake.callsTo('GET', MEMBERS)).toHaveLength(2);
  });

  it("gives an empty map when members can't be listed", async () => {
    await expect(projectPeople('org_1', 'prj_1')).resolves.toEqual(new Map());
  });
});
