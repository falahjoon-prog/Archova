import { describe, expect, it } from 'vitest';
import { MemorySyncStore, syncStoreConformance } from '../src/testing';

const MODULE_OF: Record<string, string> = { defect: 'defects', diary_labour: 'diary' };

syncStoreConformance(
  'MemorySyncStore',
  async () => {
    const store = new MemorySyncStore({ moduleOf: (t) => MODULE_OF[t]! });
    return {
      store,
      write: (record, entry) => store.write(record, entry),
      get: async (entityType, id) => store.get(entityType, id),
      keys: async () => [...store.records.keys()].sort(),
    };
  },
  { describe, it, expect },
);
