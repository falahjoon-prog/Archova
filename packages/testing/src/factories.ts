import { randomUUID } from 'node:crypto';

/** Unique, valid test data. Factories create through the public API so tests exercise real rules. */
export const uniqueEmail = (label = 'user') => `${label}.${randomUUID().slice(0, 8)}@example.com`;
export const TEST_PASSWORD = 'correct-horse-battery';
export const uniqueSlug = (label = 'org') => `${label}-${randomUUID().slice(0, 8)}`;
