import { describe, expect, it } from 'vitest';
import { glossaryFor, protectText, restoreText } from '../../src/domain/translation';

describe('safety translation protection (compliance/08 §4)', () => {
  it('protects phone numbers, times, addresses, units, codes, emails and kept terms', () => {
    const cases: Array<[string, string[]]> = [
      ['Call 000 and give the address 5 Riverbend Drive.', ['000', '5']],
      ['Site manager: Priscilla Tan, mobile 0434 555 661.', ['0434 555 661']],
      ['Site hours are 7:00 am to 3:30 pm.', ['7:00 am', '3:30 pm']],
      ['Keep 3 m clear; hearing protection above 85 dB(A).', ['3 m', '85 dB(A)']],
      ['Stay outside the exclusion zone on drawing A-301 and RFI 014.', ['A-301', 'RFI 014']],
      ['Tower crane TC-1 lifts until 3:00 pm.', ['TC-1', '3:00 pm']],
      ['Read the SWMS and wear PPE.', ['SWMS', 'PPE']],
      ['Email safety@site.example.com.au today.', ['safety@site.example.com.au']],
    ];
    for (const [text, tokens] of cases) expect(protectText(text).tokens).toEqual(tokens);
  });

  it("leaves words alone: 'metres', 'Anzac', 'Level' and a sentence's own numbers", () => {
    const p = protectText('Walk 3 metres to Anzac Parade, Level 1.');
    expect(p.tokens).toEqual(['3', '1']);
    expect(p.text).toBe('Walk ⟦1⟧ metres to Anzac Parade, Level ⟦2⟧.');
  });

  it('restores placeholders, and rejects a dropped, repeated or invented one', () => {
    const p = protectText('Call 0434 555 661 before 7:00 am.');
    expect(restoreText('Gọi ⟦1⟧ trước ⟦2⟧.', p.tokens)).toBe('Gọi 0434 555 661 trước 7:00 am.');
    // Reordered is fine: the sentence order differs between languages.
    expect(restoreText('⟦2⟧ trước, gọi ⟦1⟧.', p.tokens)).toBe('7:00 am trước, gọi 0434 555 661.');
    expect(restoreText('Gọi ⟦1⟧.', p.tokens)).toBeNull();
    expect(restoreText('Gọi ⟦1⟧ ⟦1⟧.', p.tokens)).toBeNull();
    expect(restoreText('Gọi ⟦1⟧ ⟦3⟧.', p.tokens)).toBeNull();
  });

  it('sends only the glossary terms an item uses', () => {
    const glossary = {
      version: 1,
      terms: [
        { en: 'hard hat', target: 'mũ bảo hộ' },
        { en: 'exclusion zone', target: 'khu vực cấm' },
      ],
    };
    expect(glossaryFor('Wear a Hard hat at all times.', glossary)).toEqual([glossary.terms[0]]);
  });
});
