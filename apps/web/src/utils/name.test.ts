import { describe, expect, it } from 'vitest';

import { enteredName, isBlankName, nameKey, trimName } from '@/utils/name';

/**
 * The client half of `0024`'s `name_key`. The half that runs both over every
 * code point against the live database is `test/name-key.test.ts`.
 */

const WHITE = [
  '\u0009',
  '\u000A',
  '\u000B',
  '\u000C',
  '\u000D',
  '\u001C',
  '\u001F',
  ' ',
  '\u0085',
  '\u00A0',
  '\u1680',
  '\u2000',
  '\u2007',
  '\u200A',
  '\u2028',
  '\u2029',
  '\u202F',
  '\u205F',
  '\u3000',
  '\uFEFF',
];

describe('a name is blank in one white-space class', () => {
  it.each(WHITE.map((character) => [character]))('%j alone is blank', (character) => {
    expect(isBlankName(character)).toBe(true);
    expect(enteredName(character)).toBeNull();
  });

  it('counts a zero-width space and a letter as something', () => {
    expect(isBlankName('\u200B')).toBe(false);
    expect(isBlankName('\u180E')).toBe(false);
    expect(isBlankName('\tX\u00A0')).toBe(false);
  });

  it('strips every one of them from both ends, and none from the middle', () => {
    const all = WHITE.join('');

    expect(trimName(`${all}Ana Marija${all}`)).toBe('Ana Marija');
    expect(trimName('Ana\u00A0Marija')).toBe('Ana\u00A0Marija');
  });
});

describe('the stored name is what it was before 0024', () => {
  it('is `trim()`med, byte for byte', () => {
    expect(enteredName('  Tim\t')).toBe('Tim');
    // NEL is outside `trim`'s class: blank on its own, kept around a name.
    expect(enteredName('Tim\u0085')).toBe('Tim\u0085');
    // Never normalized: a decomposed name is stored as it was typed.
    expect(enteredName('Noc\u0301')).toBe('Noc\u0301');
  });
});

describe('the key compares trimmed, NFC and lower-cased', () => {
  it('reads a padded name as the name', () => {
    expect(nameKey('Tim\t', 'hr')).toBe(nameKey('Tim', 'hr'));
    expect(nameKey('\u00A0TIM\u202F', 'hr')).toBe('tim');
  });

  it('reads composed and decomposed as one name', () => {
    const composed = 'Noć';
    const decomposed = 'Noc\u0301';

    expect(composed).not.toBe(decomposed);
    expect(nameKey(decomposed, 'hr')).toBe(nameKey(composed, 'hr'));
    expect(nameKey('ČAĐA', 'hr')).toBe(nameKey('C\u030CAĐA', 'hr'));
  });

  it('keeps apart names that differ inside', () => {
    expect(nameKey('Ana Marija', 'hr')).not.toBe(nameKey('AnaMarija', 'hr'));
  });
});
