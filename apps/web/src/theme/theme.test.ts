import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { nextPreference, resolveTheme, STORAGE_KEY, THEME_PREFERENCES } from '@/theme/theme';

describe('resolveTheme', () => {
  it('follows the operating system while the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('holds a pinned theme whatever the operating system says', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('nextPreference', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextPreference('system')).toBe('light');
    expect(nextPreference('light')).toBe('dark');
    expect(nextPreference('dark')).toBe('system');
  });
});

describe('the pre-paint script in index.html agrees with this module', () => {
  // Two authorings of one resolution: the inline script runs before the bundle
  // exists, so it cannot import this file. A renamed key or value in either
  // would resolve the first paint one way and the app another.
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  it('reads the same storage key', () => {
    expect(html).toContain(`localStorage.getItem('${STORAGE_KEY}')`);
  });

  it('recognises every pinned value, and system is the absence of one', () => {
    for (const preference of THEME_PREFERENCES.filter((value) => value !== 'system')) {
      expect(html).toContain(`stored === '${preference}'`);
    }
  });

  it('writes the resolved theme to data-theme', () => {
    expect(html).toContain('document.documentElement.dataset.theme');
  });
});
