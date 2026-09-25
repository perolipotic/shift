import { ranksShown } from '@/members/rank';

/**
 * A member's position in their team, as data (team position, part B of "rank
 * and team position").
 *
 * PART OF THE MEMBERSHIP VERSION, not of the member. A position change is a new
 * `team_membership_versions` row from a date — the same team with a different
 * position — under `0010`'s versioning rules, so a promotion from next month is
 * scheduled and withdrawn exactly like a move.
 *
 * ONE LIST, TWO COPIES THAT MUST AGREE. The database enumerates the codes in
 * the column's check constraint (`0015`) and `hr.json` names each code under
 * `smjene.position.*`. `position.test.ts` parses the constraint out of the
 * migration and compares it to {@link POSITION_CODES} in both directions.
 *
 * GATED BY THE SAME SETTING AS THE RANK. `organizations.uses_fire_ranks` is
 * "uses fire ranks and positions": while it is on, a version naming a team
 * must carry a position (`0015`'s insert policy), and the screens offer and
 * show one; while it is off, the client sends `null` and shows none.
 *
 * NOTHING HERE IS A GATE ON VALUES. The database refuses a code outside the
 * list; this module's job when handed one is to render something rather than
 * to throw — see {@link positionOf}.
 */

/** The position codes, in the order every control offers them. No limit per team. */
export const POSITION_CODES = ['commander', 'driver', 'firefighter'] as const;

export type PositionCode = (typeof POSITION_CODES)[number];

/**
 * A stored value this build has no code for — the unknown rank's reason:
 * the migration stream and the static SPA are not promoted at the same
 * instant, and the honest answer is "unknown position", never a crash.
 */
export const UNKNOWN_POSITION = 'UNKNOWN_POSITION';

/** The position a move into a team opens on while the setting is on. */
export const DEFAULT_POSITION: PositionCode = 'firefighter';

/** Whether a stored value is a code this build knows. */
export function isPositionCode(value: string | null): value is PositionCode {
  return value !== null && (POSITION_CODES as readonly string[]).includes(value);
}

/**
 * A stored position as this build reads it: a known code, `null` for none (a
 * version written while the setting was off, or one naming no team), or
 * {@link UNKNOWN_POSITION}. Never throws.
 */
export function positionOf(value: string | null): PositionCode | null | typeof UNKNOWN_POSITION {
  if (value === null) return null;

  return isPositionCode(value) ? value : UNKNOWN_POSITION;
}

/**
 * The message key one position renders as — the only place a code becomes
 * words. A code this build lacks is `smjene.position.unknown`. Lowercase
 * labels, because they read as a noun beside a name.
 */
export function positionMessageKey(
  position: string,
):
  | 'smjene.position.unknown'
  | 'smjene.position.commander'
  | 'smjene.position.driver'
  | 'smjene.position.firefighter' {
  const read = isPositionCode(position) ? position : UNKNOWN_POSITION;

  if (read === UNKNOWN_POSITION) return 'smjene.position.unknown';
  if (read === 'commander') return 'smjene.position.commander';
  if (read === 'driver') return 'smjene.position.driver';
  if (read === 'firefighter') return 'smjene.position.firefighter';

  // EXHAUSTIVE over the codes: a fourth code without a branch here is a
  // `pnpm typecheck` failure.
  const unhandled: never = read;

  return unhandled;
}

/**
 * The options the position control offers for one stored position: the fixed
 * list, plus the stored value itself when it is a code this build lacks, so
 * the control describes the row honestly. `rankOptionsFor`'s rule.
 */
export function positionOptionsFor(stored: string | null): readonly string[] {
  return positionOf(stored) === UNKNOWN_POSITION && stored !== null
    ? [stored, ...POSITION_CODES]
    : POSITION_CODES;
}

/**
 * What a position `<select>`'s value IS. A LOOKUP, NEVER A CAST: a known code
 * is itself, the stored value (an unknown code the control offered as its own
 * option) is kept as it was, and anything else is `undefined` — a value the
 * control never rendered, which the screen reads as stale.
 */
export function chosenPosition(value: string, stored: string | null): string | undefined {
  if (isPositionCode(value)) return value;
  if (stored !== null && value === stored) return stored;

  return undefined;
}

/**
 * Whether a surface offers or shows positions: the rank setting, which is
 * "uses fire ranks and positions". Off, stored positions survive untouched.
 */
export function positionsShown(organization: { readonly usesFireRanks: boolean } | null): boolean {
  return ranksShown(organization);
}

/**
 * The position text shown beside a name, or `null` for none: the setting off,
 * or the version carries no position. A code this build lacks is still shown,
 * as "unknown position".
 */
export function rosterPositionMessageKey(
  position: string | null,
  shown: boolean,
): ReturnType<typeof positionMessageKey> | null {
  if (!shown || position === null) return null;

  return positionMessageKey(position);
}

/**
 * The roster sentence for one member, by what stands beside the name: the
 * rank, the position, both, or neither (`null`, the name alone).
 */
export function rosterLineMessageKey(
  hasRank: boolean,
  hasPosition: boolean,
):
  | 'smjene.roster.withRank'
  | 'smjene.roster.withPosition'
  | 'smjene.roster.withRankAndPosition'
  | null {
  if (hasRank && hasPosition) return 'smjene.roster.withRankAndPosition';
  if (hasPosition) return 'smjene.roster.withPosition';
  if (hasRank) return 'smjene.roster.withRank';

  return null;
}

/** A roster line to render: a sentence key with its values, or the name alone. */
export type RosterLine =
  | {
      readonly key: NonNullable<ReturnType<typeof rosterLineMessageKey>>;
      readonly values: {
        readonly name: string;
        readonly rank?: string;
        readonly position?: string;
      };
    }
  | { readonly key: null; readonly text: string };

/**
 * One member's roster line, decided here rather than in the `.tsx`. `rank`
 * and `position` are the label keys to show beside the name (`null` for none,
 * as `rosterRankMessageKey` and {@link rosterPositionMessageKey} answer), and
 * `translate` turns one into words — `t` on the screen, anything in a test.
 */
export function rosterLineOf<Rank extends string, Position extends string>(
  name: string,
  rank: Rank | null,
  position: Position | null,
  translate: (key: Rank | Position) => string,
): RosterLine {
  const key = rosterLineMessageKey(rank !== null, position !== null);

  if (key === null) return { key: null, text: name };

  return {
    key,
    values: {
      name,
      ...(rank === null ? {} : { rank: translate(rank) }),
      ...(position === null ? {} : { position: translate(position) }),
    },
  };
}
