import { describe, expect, it, vi } from 'vitest';
import { parseVoice, readBack, spokenHours } from '../features/voice';

vi.mock('../features/voice/screens/VoiceScreen', () => ({}));

describe('parseVoice', () => {
  it('takes a diary note and capitalises it', () => {
    expect(parseVoice('diary note, slab pour on level 2 finished')).toEqual({
      kind: 'diary.note',
      text: 'Slab pour on level 2 finished',
    });
    expect(parseVoice('add to the site diary: crane booked tomorrow').kind).toBe('diary.note');
    expect(parseVoice('add a note to diary scaffold inspected')).toMatchObject({
      kind: 'diary.note',
    });
  });
  it('logs a delay with spoken hours', () => {
    expect(parseVoice('log delay rain for two hours')).toEqual({
      kind: 'diary.delay',
      description: 'Rain',
      hours: 2,
    });
    expect(parseVoice('log a delay waiting on concrete 1.5 hours')).toMatchObject({ hours: 1.5 });
    expect(parseVoice('log delay rain').kind).toBe('unknown');
  });
  it('raises RFIs and incidents', () => {
    expect(parseVoice('raise an RFI about beam size at gridline C')).toEqual({
      kind: 'rfi.raise',
      text: 'Beam size at gridline C',
    });
    expect(parseVoice('report near miss, load swung near the gate')).toEqual({
      kind: 'incident.report',
      text: 'Load swung near the gate',
    });
  });
  it('asks Nova', () => {
    expect(parseVoice('hey Nova what is the slab thickness on level 3')).toEqual({
      kind: 'nova.ask',
      question: 'What is the slab thickness on level 3',
    });
  });
  it('confirms and cancels, and never guesses', () => {
    expect(parseVoice('Yes')).toEqual({ kind: 'confirm' });
    expect(parseVoice('cancel that')).toEqual({ kind: 'cancel' });
    expect(parseVoice('banana')).toEqual({ kind: 'unknown', heard: 'banana' });
    expect(parseVoice('   ')).toEqual({ kind: 'unknown', heard: '' });
  });
  it('rejects empty bodies', () => {
    expect(parseVoice('diary note').kind).toBe('unknown');
  });
});

describe('spokenHours', () => {
  it('reads digits and words, within a day', () => {
    expect(spokenHours('three hours')).toBe(3);
    expect(spokenHours('half an hour')).toBe(0.5);
    expect(spokenHours('one and a half hours')).toBe(1.5);
    expect(spokenHours('30 hours')).toBeNull();
    expect(spokenHours('no time')).toBeNull();
  });
});

describe('readBack', () => {
  it('reads the action back before saving', () => {
    expect(readBack(parseVoice('diary note rain stopped'))).toContain('Say yes');
    expect(readBack({ kind: 'unknown', heard: 'x' })).toContain("didn't catch");
  });
});
