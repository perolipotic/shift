import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  chosenRank,
  fireRankOf,
  fireRanksClearsFailure,
  fireRanksControlKey,
  fireRanksFollowUpOf,
  fireRanksMessageKey,
  fireRanksOf,
  fireRanksStatusMessageKey,
  fireRanksStepOf,
  fireRanksValue,
  FIRE_RANKS_OFF,
  FIRE_RANKS_ON,
  FIRE_RANKS_OPTIONS,
  FIRE_RANKS_QUEUE,
  FIRE_RANKS_WRITE,
  isRankCode,
  NO_RANK,
  rankEditOf,
  rankInitialValue,
  rankMessageKey,
  rankOptionsFor,
  rankValue,
  ranksShown,
  RANK_CODES,
  RANK_OPTIONS,
  rosterRankMessageKey,
  UNKNOWN_RANK,
} from '@/members/rank';

/**
 * The fixed rank list, held together across the files it lives in (member
 * rank, part A): `0014`'s check constraint, `@/members/rank`, and `hr.json`.
 * Each side is PARSED out of the artifact that ships, never restated here.
 */

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

const MIGRATION = join(repoRoot, 'supabase', 'migrations', '0014_member_fire_rank.sql');
const RESOURCE = join(srcRoot, 'i18n', 'locales', 'hr.json');

/** Comment-blind: the migration explains the list in prose. */
function migrationStatements(): string {
  return readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** The codes `0014`'s check constraint admits, in declaration order. */
function constrainedCodes(): string[] {
  const list = /check\s*\(\s*fire_rank\s+in\s*\(([^)]*)\)/i.exec(migrationStatements())?.[1];

  return [...(list ?? '').matchAll(/'([^']*)'/g)].map((found) => found[1] ?? '');
}

function resourceKeys(): string[] {
  const walk = (node: unknown, prefix: string): string[] => {
    if (typeof node !== 'object' || node === null) return [prefix];

    return Object.entries(node).flatMap(([key, value]) =>
      walk(value, prefix === '' ? key : `${prefix}.${key}`),
    );
  };

  return walk(JSON.parse(readFileSync(RESOURCE, 'utf8')), '');
}

function resource(): Record<string, unknown> {
  return JSON.parse(readFileSync(RESOURCE, 'utf8')) as Record<string, unknown>;
}

describe('the rank list is one list, not three that resemble each other', () => {
  it('reads a constraint that exists, so the comparisons below mean something', () => {
    expect(constrainedCodes()).toHaveLength(11);
  });

  it('agrees with the check constraint in 0014, in both directions and in order', () => {
    // A code in the constraint and not here is a rank the database admits and
    // no control can offer; a code here and not there is an option the
    // database refuses with 23514 the moment somebody picks it.
    const constrained = constrainedCodes();

    for (const code of constrained) expect(RANK_CODES as readonly string[]).toContain(code);
    for (const code of RANK_CODES) expect(constrained).toContain(code);
    expect([...RANK_CODES]).toEqual(constrained);
  });

  it('stores stable ASCII codes, never words', () => {
    for (const code of RANK_CODES) expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('has a distinct label for every code, for no rank and for an unknown rank', () => {
    const declared = resourceKeys();
    const keys = [...RANK_OPTIONS, 'not-a-code'].map((rank) => rankMessageKey(rank));

    for (const key of keys) expect(declared, `${key} has no label`).toContain(key);
    expect(new Set(keys).size, 'two ranks share one label').toBe(keys.length);
  });

  it('labels each code with its fixed Croatian name', () => {
    const labels = (resource()['ljudi'] as Record<string, Record<string, string>>)['rank'] ?? {};
    const named = (code: string): string =>
      labels[rankMessageKey(code).replace('ljudi.rank.', '')] ?? '';

    expect(RANK_CODES.map(named)).toEqual([
      'vatrogasac pripravnik',
      'vatrogasac',
      'vatrogasac I. klase',
      'vatrogasni dočasnik',
      'vatrogasni dočasnik I. klase',
      'viši vatrogasni dočasnik',
      'viši vatrogasni dočasnik I. klase',
      'vatrogasni časnik',
      'vatrogasni časnik I. klase',
      'viši vatrogasni časnik',
      'viši vatrogasni časnik I. klase',
    ]);
  });

  it('offers no rank first, then the codes in list order', () => {
    expect(RANK_OPTIONS).toEqual([null, ...RANK_CODES]);
  });
});

describe('a stored rank reads as a code, none, or unknown, and never throws', () => {
  it('narrows a known code, keeps null as none and names anything else unknown', () => {
    expect(fireRankOf('nco')).toBe('nco');
    expect(fireRankOf(null)).toBeNull();
    expect(fireRankOf('general')).toBe(UNKNOWN_RANK);
    expect(fireRankOf('')).toBe(UNKNOWN_RANK);
    expect(RANK_CODES as readonly string[]).not.toContain(UNKNOWN_RANK);
    expect(isRankCode('officer')).toBe(true);
    expect(isRankCode(null)).toBe(false);
  });

  it('labels an unknown code as unknown, never as no rank', () => {
    expect(rankMessageKey('general')).toBe('ljudi.rank.unknown');
    expect(rankMessageKey(null)).toBe('ljudi.rank.none');
    expect(rankMessageKey('officer')).toBe('ljudi.rank.officer');
  });

  it('offers a stored unknown code as its own option on the edit control', () => {
    expect(rankOptionsFor('general')).toEqual(['general', ...RANK_OPTIONS]);
    expect(rankOptionsFor('nco')).toEqual(RANK_OPTIONS);
    expect(rankOptionsFor(null)).toEqual(RANK_OPTIONS);
  });
});

describe('the rank control crosses between strings and the column', () => {
  it('carries no rank as the empty value and a code as itself', () => {
    expect(rankValue(null)).toBe(NO_RANK);
    expect(rankValue('nco')).toBe('nco');
  });

  it('reads the empty choice as null, a code as itself, and keeps the stored value otherwise', () => {
    expect(chosenRank(NO_RANK, 'nco')).toBeNull();
    expect(chosenRank('officer', 'nco')).toBe('officer');
    // The unknown option sends back exactly what the row holds.
    expect(chosenRank('general', 'general')).toBe('general');
    // Anything else changes nothing.
    expect(chosenRank('bogus', 'nco')).toBe('nco');
    // On the create form there is nothing stored, so it is no rank.
    expect(chosenRank('bogus', null)).toBeNull();
  });
});

describe('what one form save sends for the rank', () => {
  it('seeds the control with the row as it is', () => {
    expect(rankInitialValue(null)).toBe(NO_RANK);
    expect(rankInitialValue('nco')).toBe('nco');
    expect(rankInitialValue('general')).toBe('general');
  });

  it('omits the rank entirely while the control is not offered', () => {
    expect(rankEditOf('nco', 'officer', false)).toEqual({});
    expect(rankEditOf('nco', null, true)).toEqual({});
    expect(Object.keys(rankEditOf('nco', 'officer', false))).not.toContain('fireRank');
  });

  it('sends an untouched known rank back unchanged', () => {
    expect(rankEditOf('nco', rankInitialValue('nco'), true)).toEqual({ fireRank: 'nco' });
  });

  it('sends an untouched unknown stored code back unchanged, never null', () => {
    expect(rankEditOf('general', rankInitialValue('general'), true)).toEqual({
      fireRank: 'general',
    });
  });

  it('sends the empty choice as null and a newly chosen code as itself', () => {
    expect(rankEditOf('nco', NO_RANK, true)).toEqual({ fireRank: null });
    expect(rankEditOf('nco', 'officer', true)).toEqual({ fireRank: 'officer' });
    expect(rankEditOf(null, 'trainee', true)).toEqual({ fireRank: 'trainee' });
  });

  it('keeps no rank as no rank when the create form is left on its default', () => {
    expect(rankEditOf(null, rankInitialValue(null), true)).toEqual({ fireRank: null });
  });
});

describe('the setting gates display and entry only', () => {
  it('shows ranks only when the organization has switched the setting on', () => {
    expect(ranksShown({ usesFireRanks: true })).toBe(true);
    expect(ranksShown({ usesFireRanks: false })).toBe(false);
    expect(ranksShown(null)).toBe(false);
  });

  it('puts a rank beside a roster name only when shown and present', () => {
    expect(rosterRankMessageKey('officer', true)).toBe('ljudi.rank.officer');
    expect(rosterRankMessageKey(null, true)).toBeNull();
    expect(rosterRankMessageKey('officer', false)).toBeNull();
    // Unknown, in the roster's own lowercase form rather than the forms' label.
    expect(rosterRankMessageKey('general', true)).toBe('smjene.roster.rankUnknown');
  });

  it('reads every roster rank label in lowercase, beside a name', () => {
    const catalogue = resource();
    const at = (key: string): string =>
      String(
        key
          .split('.')
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            catalogue,
          ),
      );

    for (const code of [...RANK_CODES, 'general']) {
      const key = rosterRankMessageKey(code, true) ?? '';
      const label = at(key);

      expect(label, `${key} is not declared`).not.toBe('undefined');
      expect(label.charAt(0), `${key} is capitalised beside a name`).toBe(
        label.charAt(0).toLowerCase(),
      );
    }
  });

  it('crosses the setting control in both directions, off first', () => {
    expect(FIRE_RANKS_OPTIONS).toEqual([false, true]);
    for (const uses of FIRE_RANKS_OPTIONS) {
      for (const stored of [true, false]) {
        expect(fireRanksOf(fireRanksValue(uses), stored)).toBe(uses);
      }
    }
    expect(fireRanksOf(FIRE_RANKS_ON, false)).toBe(true);
    expect(fireRanksOf(FIRE_RANKS_OFF, true)).toBe(false);
    expect(fireRanksValue(true)).not.toBe(fireRanksValue(false));
  });

  it('keeps the stored setting for a value that is neither option', () => {
    // The change-nothing direction, as `chosenRank` takes: an unexpected value
    // must never write "off" over an organization that records ranks.
    expect(fireRanksOf('anything', true)).toBe(true);
    expect(fireRanksOf('', false)).toBe(false);
  });

  it('names both states of the setting, and says what the status line is about', () => {
    const declared = resourceKeys();

    for (const uses of FIRE_RANKS_OPTIONS) {
      expect(declared).toContain(fireRanksMessageKey(uses));
      expect(declared).toContain(fireRanksStatusMessageKey(uses));
    }
    expect(fireRanksMessageKey(true)).not.toBe(fireRanksMessageKey(false));
    expect(fireRanksStatusMessageKey(true)).not.toBe(fireRanksStatusMessageKey(false));

    const labels = resource()['organization'] as Record<string, string>;
    const subject = labels['fireRanks'] ?? '';

    expect(subject.length).toBeGreaterThan(0);
    for (const uses of FIRE_RANKS_OPTIONS) {
      const status = labels[fireRanksStatusMessageKey(uses).replace('organization.', '')] ?? '';

      expect(status, 'the status line does not name the setting').toContain(subject);
    }
  });

  it('remounts the setting control on every refusal and every stored change', () => {
    expect(fireRanksControlKey(true, 0)).not.toBe(fireRanksControlKey(true, 1));
    expect(fireRanksControlKey(true, 0)).not.toBe(fireRanksControlKey(false, 0));
    expect(fireRanksControlKey(false, 2)).toBe(fireRanksControlKey(false, 2));
  });

  it('queues a change while ANY write is in flight, and writes it otherwise', () => {
    expect(fireRanksStepOf(false, false)).toBe(FIRE_RANKS_WRITE);
    expect(fireRanksStepOf(true, false)).toBe(FIRE_RANKS_QUEUE);
    expect(fireRanksStepOf(false, true)).toBe(FIRE_RANKS_QUEUE);
    expect(fireRanksStepOf(true, true)).toBe(FIRE_RANKS_QUEUE);
  });

  it('drops the queued follow-up after a refusal, and applies it otherwise', () => {
    expect(fireRanksFollowUpOf(true, false)).toBe(true);
    expect(fireRanksFollowUpOf(false, false)).toBe(false);
    expect(fireRanksFollowUpOf(undefined, false)).toBeUndefined();
    expect(fireRanksFollowUpOf(true, true)).toBeUndefined();
    expect(fireRanksFollowUpOf(false, true)).toBeUndefined();
  });

  it('clears the message region for a fresh choice, never for a queued follow-up', () => {
    expect(fireRanksClearsFailure(false)).toBe(true);
    expect(fireRanksClearsFailure(true)).toBe(false);
  });
});
