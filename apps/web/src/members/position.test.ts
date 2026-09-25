import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  chosenPosition,
  DEFAULT_POSITION,
  isPositionCode,
  positionMessageKey,
  positionOf,
  positionOptionsFor,
  positionsShown,
  POSITION_CODES,
  rosterLineMessageKey,
  rosterLineOf,
  rosterPositionMessageKey,
  UNKNOWN_POSITION,
} from '@/members/position';

/**
 * The fixed position list, held together across the files it lives in (team
 * position, part B): `0015`'s check constraint, `@/members/position`, and
 * `hr.json`. Each side is PARSED out of the artifact that ships.
 */

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

const MIGRATION = join(repoRoot, 'supabase', 'migrations', '0015_team_position.sql');
const RESOURCE = join(srcRoot, 'i18n', 'locales', 'hr.json');

/** Comment-blind: the migration explains the list in prose. */
function migrationStatements(): string {
  return readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** The codes `0015`'s check constraint admits, in declaration order. */
function constrainedCodes(): string[] {
  const list = /check\s*\(\s*position\s+in\s*\(([^)]*)\)/i.exec(migrationStatements())?.[1];

  return [...(list ?? '').matchAll(/'([^']*)'/g)].map((found) => found[1] ?? '');
}

function resource(): Record<string, unknown> {
  return JSON.parse(readFileSync(RESOURCE, 'utf8')) as Record<string, unknown>;
}

/** The catalogue value at a dotted key, or `undefined`. */
function at(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      resource(),
    );
}

describe('the position list is one list, not two that resemble each other', () => {
  it('reads a constraint that exists, so the comparisons below mean something', () => {
    expect(constrainedCodes()).toHaveLength(3);
  });

  it('agrees with the check constraint in 0015, in both directions and in order', () => {
    const constrained = constrainedCodes();

    for (const code of constrained) expect(POSITION_CODES as readonly string[]).toContain(code);
    for (const code of POSITION_CODES) expect(constrained).toContain(code);
    expect([...POSITION_CODES]).toEqual(constrained);
  });

  it('forbids a position on a version that names no team, in the table itself', () => {
    expect(migrationStatements()).toMatch(/check \(team_id is not null or position is null\)/);
  });

  it('stores stable ASCII codes, never words', () => {
    for (const code of POSITION_CODES) expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('labels each code with its fixed Croatian noun, lowercase, and an unknown one distinctly', () => {
    expect(POSITION_CODES.map((code) => at(positionMessageKey(code)))).toEqual([
      'zapovjednik',
      'vozač',
      'vatrogasac',
    ]);

    const keys = [...POSITION_CODES, 'chief'].map((code) => positionMessageKey(code));

    expect(new Set(keys).size, 'two positions share one label').toBe(keys.length);
    for (const key of keys) {
      const label = String(at(key));

      expect(label, `${key} is not declared`).not.toBe('undefined');
      expect(label.charAt(0), `${key} is capitalised beside a name`).toBe(
        label.charAt(0).toLowerCase(),
      );
      expect(key.startsWith('smjene.position.')).toBe(true);
    }
  });

  it('opens a move into a team on firefighter, one of the codes', () => {
    expect(DEFAULT_POSITION).toBe('firefighter');
    expect(POSITION_CODES).toContain(DEFAULT_POSITION);
  });
});

describe('a stored position reads as a code, none, or unknown, and never throws', () => {
  it('narrows a known code, keeps null as none and names anything else unknown', () => {
    expect(positionOf('driver')).toBe('driver');
    expect(positionOf(null)).toBeNull();
    expect(positionOf('chief')).toBe(UNKNOWN_POSITION);
    expect(positionOf('')).toBe(UNKNOWN_POSITION);
    expect(isPositionCode('commander')).toBe(true);
    expect(isPositionCode(null)).toBe(false);
    expect(positionMessageKey('chief')).toBe('smjene.position.unknown');
  });

  it('offers a stored unknown code as its own option, and reads a pick by lookup', () => {
    expect(positionOptionsFor('chief')).toEqual(['chief', ...POSITION_CODES]);
    expect(positionOptionsFor('driver')).toEqual(POSITION_CODES);
    expect(positionOptionsFor(null)).toEqual(POSITION_CODES);

    expect(chosenPosition('driver', null)).toBe('driver');
    expect(chosenPosition('chief', 'chief')).toBe('chief');
    expect(chosenPosition('chief', null)).toBeUndefined();
    expect(chosenPosition('', 'driver')).toBeUndefined();
  });
});

describe('the setting gates display and entry only', () => {
  it('shows positions only while the organization uses fire ranks and positions', () => {
    expect(positionsShown({ usesFireRanks: true })).toBe(true);
    expect(positionsShown({ usesFireRanks: false })).toBe(false);
    expect(positionsShown(null)).toBe(false);
  });

  it('puts a position beside a roster name only when shown and present', () => {
    expect(rosterPositionMessageKey('driver', true)).toBe('smjene.position.driver');
    expect(rosterPositionMessageKey(null, true)).toBeNull();
    expect(rosterPositionMessageKey('driver', false)).toBeNull();
    expect(rosterPositionMessageKey('chief', true)).toBe('smjene.position.unknown');
  });

  it('builds the roster line for each of the four cases, name only included', () => {
    const translate = (key: string): string => `<${key}>`;

    expect(rosterLineOf('Ana', null, null, translate)).toEqual({ key: null, text: 'Ana' });
    expect(rosterLineOf('Ana', 'ljudi.rank.nco', null, translate)).toEqual({
      key: 'smjene.roster.withRank',
      values: { name: 'Ana', rank: '<ljudi.rank.nco>' },
    });
    expect(rosterLineOf('Ana', null, 'smjene.position.driver', translate)).toEqual({
      key: 'smjene.roster.withPosition',
      values: { name: 'Ana', position: '<smjene.position.driver>' },
    });
    expect(rosterLineOf('Ana', 'ljudi.rank.nco', 'smjene.position.driver', translate)).toEqual({
      key: 'smjene.roster.withRankAndPosition',
      values: { name: 'Ana', rank: '<ljudi.rank.nco>', position: '<smjene.position.driver>' },
    });
    expect(rosterLineMessageKey(false, false)).toBeNull();
    expect(at('smjene.roster.withPosition')).toBe('{name} · {position}');
    expect(at('smjene.roster.withRankAndPosition')).toBe('{name} · {rank} · {position}');
  });
});
