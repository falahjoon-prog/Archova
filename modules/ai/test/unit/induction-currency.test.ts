import { describe, expect, it } from 'vitest';
import {
  citedSources,
  compareSources,
  type CitingDraft,
  type DraftCitationRef,
  type LiveRevision,
} from '../../src/domain/induction-currency';

const cite = (
  sourceId: string,
  revisionId: string | null,
  over: Partial<DraftCitationRef> = {},
): DraftCitationRef => ({
  sourceType: 'document',
  sourceId,
  revisionId,
  title: `Title of ${sourceId}`,
  ...over,
});

const item = (...citations: DraftCitationRef[]) => ({ citations });

const draft: CitingDraft = {
  sections: [
    {
      section: 'emergencies_and_first_aid',
      slides: [
        { points: [item(cite('plan', 'plan-a'))], script: [item(cite('plan', 'plan-a'))] },
        { points: [item(cite('rules', 'rules-a'))], script: [] },
      ],
    },
    {
      section: 'site_rules',
      slides: [{ points: [item(cite('rules', 'rules-a'))], script: [] }],
    },
    // Not covered: nothing to cite.
    { section: 'ppe', slides: [] },
  ],
  quiz: [
    { section: 'emergencies_and_first_aid', citations: [cite('plan', 'plan-a')] },
    {
      section: 'site_rules',
      citations: [cite('rules', 'rules-a'), cite('rules', 'rules-a'), cite('plan', 'plan-a')],
    },
  ],
};

const live = (
  id: string,
  status: LiveRevision['status'],
  label: string,
  accessScope = 'folder:open',
  title = `Title of ${id.split('-')[0]}`,
): LiveRevision => ({ revisionId: id, revisionLabel: label, status, accessScope, title });

describe('the sources an induction draft cites', () => {
  it('lists each document once, with the revisions cited, the sections and the quiz questions that rest on it', () => {
    const cited = citedSources(draft);
    expect(cited.map((c) => c.sourceId).sort()).toEqual(['plan', 'rules']);
    expect(cited.find((c) => c.sourceId === 'plan')).toMatchObject({
      sourceType: 'document',
      revisionIds: ['plan-a'],
      sections: ['emergencies_and_first_aid', 'site_rules'],
      quizQuestions: 2,
    });
    // One question cites `rules` twice and still counts once.
    expect(cited.find((c) => c.sourceId === 'rules')).toMatchObject({
      sections: ['emergencies_and_first_aid', 'site_rules'],
      quizQuestions: 1,
    });
  });

  it('keeps drawing sheets, and leaves out records without revisions and citations without one', () => {
    const cited = citedSources({
      sections: [
        {
          section: 'site_hazards',
          slides: [
            {
              points: [
                item(
                  cite('sheet', 'sheet-1', { sourceType: 'drawing' }),
                  cite('rfi-1', 'rfi-1', { sourceType: 'rfi' }),
                  cite('doc-x', null),
                ),
              ],
              script: [],
            },
          ],
        },
      ],
      quiz: [],
    });
    expect(cited).toMatchObject([{ sourceType: 'drawing', sourceId: 'sheet' }]);
  });

  it('notes every revision when a draft cited two of the same document', () => {
    const cited = citedSources({
      sections: [
        {
          section: 'ppe',
          slides: [
            { points: [item(cite('plan', 'plan-a'))], script: [item(cite('plan', 'plan-b'))] },
          ],
        },
      ],
      quiz: [],
    });
    expect(cited[0]!.revisionIds).toEqual(['plan-a', 'plan-b']);
  });
});

describe('what has changed since', () => {
  const cited = citedSources(draft);
  const readable = new Set(['folder:open']);

  it('says nothing is stale while every cited revision is still current', () => {
    const now = new Map([
      ['plan', [live('plan-a', 'current', 'A')]],
      ['rules', [live('rules-a', 'current', 'A')]],
    ]);
    expect(compareSources(cited, now, readable)).toEqual({
      changed: [],
      hidden: 0,
      hiddenSections: [],
    });
  });

  it('flags a document with a newer revision, naming both revisions and what rests on it', () => {
    const now = new Map([
      ['plan', [live('plan-a', 'superseded', 'A'), live('plan-b', 'current', 'B')]],
      ['rules', [live('rules-a', 'current', 'A')]],
    ]);
    const out = compareSources(cited, now, readable);
    expect(out.hidden).toBe(0);
    expect(out.changed).toEqual([
      {
        sourceType: 'document',
        sourceId: 'plan',
        title: 'Title of plan',
        citedRevision: 'A',
        currentRevision: 'B',
        reason: 'newer_revision',
        sections: ['emergencies_and_first_aid', 'site_rules'],
        quizQuestions: 2,
      },
    ]);
  });

  it('flags a source that is gone', () => {
    const now = new Map([['rules', [live('rules-a', 'current', 'A')]]]);
    expect(compareSources(cited, now, readable).changed).toMatchObject([
      {
        sourceId: 'plan',
        reason: 'withdrawn',
        citedRevision: null,
        currentRevision: null,
        title: 'Title of plan',
      },
    ]);
  });

  it('counts, and never names, a change in a source the caller cannot open', () => {
    const now = new Map([
      [
        'plan',
        [
          live('plan-a', 'superseded', 'A', 'folder:private', 'Secret plan'),
          live('plan-b', 'current', 'B', 'folder:private', 'Secret plan'),
        ],
      ],
      ['rules', [live('rules-a', 'current', 'A')]],
    ]);
    const out = compareSources(cited, now, readable);
    expect(out.changed).toEqual([]);
    expect(out.hidden).toBe(1);
    // Which sections rest on it (a quiz question counts), in the induction's order, so a refresh can leave them alone.
    expect(out.hiddenSections).toEqual(['emergencies_and_first_aid', 'site_rules']);
    expect(JSON.stringify(out)).not.toContain('Secret');
  });

  it('judges openness by where the source is now, so a document moved into a private folder is hidden', () => {
    const now = new Map([
      [
        'plan',
        [
          live('plan-a', 'superseded', 'A', 'folder:open'),
          live('plan-b', 'current', 'B', 'folder:private'),
        ],
      ],
      ['rules', [live('rules-a', 'current', 'A')]],
    ]);
    expect(compareSources(cited, now, readable)).toMatchObject({ changed: [], hidden: 1 });
  });
});
