import { describe, expect, it } from 'vitest';
import {
  DECIDER_TASKS,
  SUGGESTION_TASKS,
  decidePermission,
  isCreatorOnly,
  maySee,
} from '../../src/domain/suggestion-audience';

const ME = 'user-me';
const THEM = 'user-them';
const holds =
  (...keys: string[]) =>
  async (key: string) =>
    keys.includes(key);

describe('suggestion audience', () => {
  it('opens a task to its deciders only where the team works the draft together', () => {
    expect([...DECIDER_TASKS].sort()).toEqual([
      'drawing.titleblock',
      'induction.draft',
      'induction.refresh',
    ]);
    // Drafts built from what a person typed, photographed, uploaded or may read are theirs alone.
    for (const task of [
      'diary.summary',
      'defect.tag',
      'rfi.draft',
      'rfi.answer',
      'import.mapping',
      'quote.read',
    ])
      expect(isCreatorOnly(task)).toBe(true);
  });

  it('gives every declared task a permission to decide it', () => {
    for (const [task, def] of Object.entries(SUGGESTION_TASKS)) {
      expect(decidePermission(task)).toBe(def.permission);
      expect(def.permission).toMatch(/^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$/);
    }
  });

  it('treats a task nobody declared as creator-only and undecidable', () => {
    expect(isCreatorOnly('something.new')).toBe(true);
    expect(decidePermission('something.new')).toBeUndefined();
  });

  it('shows a row to its creator whatever they hold', async () => {
    for (const task of Object.keys(SUGGESTION_TASKS))
      expect(await maySee({ task, createdBy: ME }, ME, holds())).toBe(true);
    expect(await maySee({ task: 'something.new', createdBy: ME }, ME, holds())).toBe(true);
  });

  it('shows someone else a row only when its task is for deciders and they hold the permission', async () => {
    const sheet = { task: 'drawing.titleblock', createdBy: THEM };
    expect(await maySee(sheet, ME, holds('ai.drawing_register.extract'))).toBe(true);
    // Holding another feature's permission, or none, is not enough.
    expect(await maySee(sheet, ME, holds('ai.induction.draft'))).toBe(false);
    expect(await maySee(sheet, ME, holds())).toBe(false);

    // A creator-only task stays closed even to someone who holds its permission (an admin can write the diary).
    expect(
      await maySee({ task: 'diary.summary', createdBy: THEM }, ME, holds('diary.entries.write')),
    ).toBe(false);
    expect(await maySee({ task: 'something.new', createdBy: THEM }, ME, holds('anything'))).toBe(
      false,
    );
  });

  it('only asks about the permission of a task that is open to deciders', async () => {
    const asked: string[] = [];
    const spy = async (key: string) => {
      asked.push(key);
      return true;
    };
    await maySee({ task: 'quote.read', createdBy: THEM }, ME, spy);
    await maySee({ task: 'something.new', createdBy: THEM }, ME, spy);
    expect(asked).toEqual([]);
    await maySee({ task: 'induction.draft', createdBy: THEM }, ME, spy);
    expect(asked).toEqual(['ai.induction.draft']);
  });
});
