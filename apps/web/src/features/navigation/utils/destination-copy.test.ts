import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  destinationDescriptionMessageKey,
  destinationPlaceMessageKey,
} from '@/features/navigation/utils/destination-copy';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';

const RESOURCE = join(fileURLToPath(new URL('../../..', import.meta.url)), 'lib', 'i18n', 'locales', 'hr.json');

/** One message by its dotted key path, or `undefined`. */
function messageAt(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      JSON.parse(readFileSync(RESOURCE, 'utf8')),
    );
}

describe('every destination has a sheet description (story 7.3, frames B and D)', () => {
  it.each(DESTINATIONS)('describes $key with a message of its own', ({ key }) => {
    const description = messageAt(destinationDescriptionMessageKey(key));

    expect(typeof description, `${key} has no description in hr.json`).toBe('string');
    expect(description).not.toBe(messageAt(key));
  });

  it('gives no two destinations the same description', () => {
    const keys = DESTINATIONS.map((destination) => destinationDescriptionMessageKey(destination.key));

    expect(new Set(keys).size).toBe(DESTINATIONS.length);
    expect(new Set(keys.map((key) => messageAt(key))).size).toBe(DESTINATIONS.length);
  });

  it('says the mockup’s line for Sati', () => {
    expect(messageAt(destinationDescriptionMessageKey('nav.sati'))).toBe(
      'Sati svih osoba po mjesecu, izvoz u Excel',
    );
  });
});

describe('Više names the current place under its label', () => {
  it('shortens Postavke rotacije to Rotacija', () => {
    expect(messageAt(destinationPlaceMessageKey('nav.postavkeRotacije'))).toBe('Rotacija');
  });

  it('names every other destination by its own label', () => {
    for (const { key } of DESTINATIONS.filter((destination) => destination.key !== 'nav.postavkeRotacije')) {
      expect(destinationPlaceMessageKey(key)).toBe(key);
    }
  });

  it.each(DESTINATIONS)('resolves the place for $key in hr.json', ({ key }) => {
    expect(typeof messageAt(destinationPlaceMessageKey(key))).toBe('string');
  });
});
