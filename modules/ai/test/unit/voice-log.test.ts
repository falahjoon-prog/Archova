import { describe, expect, it } from 'vitest';
import type { VoiceLogOutput } from '@archova/ai-prompts';
import { reviewVoiceLog, voiceLogFingerprint } from '../../src/domain/voice-log';

const date = '2026-10-07'; // a Wednesday
const transcript =
  'Formwork on level four is finished. Rain stopped the crane for two hours. Order more props by Friday. Unguarded edge on the east stair void.';

const item = (
  over: Partial<VoiceLogOutput['items'][number]> = {},
): VoiceLogOutput['items'][number] => ({
  kind: 'note',
  text: 'Level 4 formwork is finished',
  quote: 'Formwork on level four is finished',
  hours: null,
  delayType: null,
  severity: null,
  dueDate: null,
  ...over,
});
const review = (items: VoiceLogOutput['items']) => reviewVoiceLog({ items }, transcript, date);

describe('reviewVoiceLog', () => {
  it('keeps an item whose quote is in the transcript', () => {
    expect(review([item({ text: 'Formwork is finished' })]).items).toHaveLength(1);
  });

  it('drops an item whose quote was not said, and a repeat', () => {
    const r = review([item({ quote: 'The slab was poured' }), item(), item()]);
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });

  it('drops a figure the quote does not contain, but accepts spoken numbers', () => {
    expect(review([item({ text: 'Formwork on level 5 is finished' })]).dropped).toBe(1);
    expect(review([item()]).dropped).toBe(0); // "level 4" in the text, "four" in the quote
  });

  it('keeps delay hours only when the quote states them', () => {
    const delay = item({
      kind: 'delay',
      text: 'Rain stopped the crane',
      quote: 'Rain stopped the crane for two hours',
      delayType: 'weather',
    });
    expect(review([{ ...delay, hours: 2 }]).items[0]!.hours).toBe(2);
    expect(review([{ ...delay, hours: 3 }]).items[0]!.hours).toBeNull();
    expect(
      review([{ ...delay, quote: 'Rain stopped the crane', hours: 2 }]).items[0]!.hours,
    ).toBeNull();
  });

  it('keeps a task due date only when the quote gives that day', () => {
    const task = item({
      kind: 'task',
      text: 'Order more props',
      quote: 'Order more props by Friday',
    });
    expect(review([{ ...task, dueDate: '2026-10-09' }]).items[0]!.dueDate).toBe('2026-10-09');
    expect(review([{ ...task, dueDate: '2026-10-10' }]).items[0]!.dueDate).toBeNull();
    expect(
      review([{ ...task, quote: 'Order more props', dueDate: '2026-10-09' }]).items[0]!.dueDate,
    ).toBeNull();
  });

  it('defaults an observation to minor and a delay type to other', () => {
    const r = review([
      item({
        kind: 'observation',
        text: 'Unguarded edge',
        quote: 'Unguarded edge on the east stair void',
      }),
      item({ kind: 'delay', text: 'Rain stopped the crane', quote: 'Rain stopped the crane' }),
    ]);
    expect(r.items[0]!.severity).toBe('minor');
    expect(r.items[1]!.delayType).toBe('other');
  });

  it('fingerprints the day and transcript', () => {
    expect(voiceLogFingerprint(date, ' a ')).toBe(voiceLogFingerprint(date, 'a'));
    expect(voiceLogFingerprint(date, 'a')).not.toBe(voiceLogFingerprint('2026-10-08', 'a'));
  });
});
