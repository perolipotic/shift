import { describe, expect, it } from 'vitest';

import { LAST_ORGANIZATION_KEY, read, remember } from '@/features/auth/services/last-organization';

/**
 * The remembered organization (story 7.7), executed on a fake `Storage` (AD-15).
 *
 * Matrix rows "Returning device" and "New device or blocked storage": a stored
 * slug prefills, and storage that is absent or throws reads as nothing, with no
 * error. The one write happens after a successful sign-in and stores only the
 * normalized slug.
 */

/** A `Storage` over a map, which records every write so a test can see them. */
function memoryStorage(initial: Record<string, string> = {}): Storage & { readonly writes: string[][] } {
  const values = new Map(Object.entries(initial));
  const writes: string[][] = [];

  return {
    writes,
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
}

/** A `Storage` whose every access throws, as blocked site data does. */
function refusingStorage(): Storage {
  const refuse = (): never => {
    throw new Error('SecurityError');
  };

  return {
    get length() {
      return refuse();
    },
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  };
}

describe('reading the last organization', () => {
  it('gives back a stored slug', () => {
    expect(read(memoryStorage({ [LAST_ORGANIZATION_KEY]: 'dvd-demo' }))).toBe('dvd-demo');
  });

  it('reads nothing on a device that has never signed in', () => {
    expect(read(memoryStorage())).toBe('');
  });

  it('reads nothing, and throws nothing, when storage refuses', () => {
    expect(read(refusingStorage())).toBe('');
  });

  it('reads nothing when the browser gives no storage at all', () => {
    expect(read(null)).toBe('');
  });

  it.each([
    ['an underscore', 'under_score'],
    ['a space inside', 'dvd demo'],
    ['an empty string', ''],
    ['a leading hyphen', '-dvd'],
    ['a label past 63 characters', 'a'.repeat(64)],
  ])('reads a stored value the slug rule refuses (%s) as nothing', (_name, stored) => {
    expect(read(memoryStorage({ [LAST_ORGANIZATION_KEY]: stored }))).toBe('');
  });

  it('reads a stored value in its normalized form', () => {
    // A value written before normalization, or edited by hand, still prefills
    // what the form would send rather than what was stored.
    expect(read(memoryStorage({ [LAST_ORGANIZATION_KEY]: '  DVD-Demo ' }))).toBe('dvd-demo');
  });
});

describe('remembering the organization after a successful sign-in', () => {
  it('stores the normalized slug under the one key, and nothing else', () => {
    const storage = memoryStorage();

    remember(storage, ' DVD-Kastel-Novi ');

    expect(storage.writes).toEqual([[LAST_ORGANIZATION_KEY, 'dvd-kastel-novi']]);
    expect(read(storage)).toBe('dvd-kastel-novi');
  });

  it('writes nothing for a value the slug rule refuses', () => {
    const storage = memoryStorage();

    remember(storage, 'Under_Score');

    expect(storage.writes).toEqual([]);
  });

  it('throws nothing when storage refuses the write', () => {
    expect(() => {
      remember(refusingStorage(), 'dvd-demo');
    }).not.toThrow();
  });

  it('throws nothing when the browser gives no storage at all', () => {
    expect(() => {
      remember(null, 'dvd-demo');
    }).not.toThrow();
  });

  it('replaces the previous organization rather than keeping a list', () => {
    const storage = memoryStorage({ [LAST_ORGANIZATION_KEY]: 'dvd-demo' });

    remember(storage, 'dvd-kastel-novi');

    expect(read(storage)).toBe('dvd-kastel-novi');
  });
});
