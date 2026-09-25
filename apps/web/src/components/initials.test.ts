import { describe, expect, it } from 'vitest';

import { initialsOf, leadingCharacterOf } from '@/components/initials';

describe('the leading character is a whole, composed code point (the lockup mark)', () => {
  it('takes a whole code point, not half a surrogate pair', () => {
    expect(leadingCharacterOf('𝒜kademija')).toBe('𝒜');
  });

  it('keeps a decomposed Croatian diacritic on its letter', () => {
    expect(leadingCharacterOf('Čakovec')).toBe('Č');
  });

  it('ignores leading whitespace and keeps the case as written', () => {
    expect(leadingCharacterOf('  kaštela')).toBe('k');
  });

  it('answers null for a blank text', () => {
    expect(leadingCharacterOf('')).toBeNull();
    expect(leadingCharacterOf(' \n\t')).toBeNull();
  });
});

describe('initials are the first letters of the first and last word', () => {
  it('takes the first and the last word, skipping the middle', () => {
    expect(initialsOf('Ivan Marić')).toBe('IM');
    expect(initialsOf('Ana Marija Horvat')).toBe('AH');
  });

  it('gives one letter for one word, and for a one-letter name', () => {
    expect(initialsOf('Alfa')).toBe('A');
    expect(initialsOf('a')).toBe('A');
  });

  it('upper-cases in Croatian and keeps the diacritics', () => {
    expect(initialsOf('đuro šimić')).toBe('ĐŠ');
  });

  it('keeps decomposed diacritics on their letters', () => {
    expect(initialsOf('Željko Ćorić')).toBe('ŽĆ');
    // A combining mark with no composed form stays attached rather than dropped.
    expect(initialsOf('q̣uinn')).toBe('Q̣');
  });

  it('treats a hyphenated first name as one word', () => {
    expect(initialsOf('Ana-Marija Horvat')).toBe('AH');
  });

  it('skips leading punctuation and digits to reach the letter', () => {
    expect(initialsOf('(Ivo) Ivić')).toBe('II');
    expect(initialsOf('3. Ivo')).toBe('I');
  });

  it('skips a word with no letter in it', () => {
    expect(initialsOf('🔥 Ivo Ivić')).toBe('II');
    expect(initialsOf('Ivo 🔥')).toBe('I');
  });

  it('collapses any run of whitespace between words', () => {
    expect(initialsOf('  Ivo \t  Ivić  ')).toBe('II');
  });

  it('answers null for a name with no letter, so the chip is drawn empty', () => {
    expect(initialsOf('')).toBeNull();
    expect(initialsOf('   ')).toBeNull();
    expect(initialsOf('🔥 42')).toBeNull();
  });
});
