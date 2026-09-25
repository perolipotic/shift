/**
 * A member's fire rank, as data (member rank, part A).
 *
 * ONE LIST, THREE COPIES THAT MUST AGREE. The database enumerates the codes in
 * `members.fire_rank`'s check constraint (`0014`), the `admin-auth` function
 * carries its own copy because it cannot import this tree, and `hr.json` names
 * each code. `rank.test.ts` parses the constraint out of the migration and
 * compares it to {@link RANK_CODES} in both directions; the boundary suite does
 * the same for the function's copy.
 *
 * A CODE, NEVER A LABEL. The row stores a stable ASCII code and the words live
 * in the message catalogue only, so renaming a rank is a translation change and
 * never a data migration.
 *
 * GATED BY A SETTING, NOT BY THIS MODULE. `organizations.uses_fire_ranks`
 * decides whether a surface offers or shows a rank; it never deletes one. The
 * helpers below that take the setting are the only place that rule is written.
 *
 * NOTHING HERE IS A GATE ON VALUES. The database refuses a code outside the
 * list; this module's job when handed one is to render something rather than
 * to throw — see {@link fireRankOf}.
 */

/**
 * The rank codes, lowest to highest, in the order every control offers them.
 *
 * `fire_rank` and never `rank`: `rank` already means role ordering in
 * `@/navigation/role`.
 */
export const RANK_CODES = [
  'trainee',
  'firefighter',
  'firefighter_1',
  'nco',
  'nco_1',
  'senior_nco',
  'senior_nco_1',
  'officer',
  'officer_1',
  'senior_officer',
  'senior_officer_1',
] as const;

export type RankCode = (typeof RANK_CODES)[number];

/**
 * A stored value this build has no code for.
 *
 * A row written by a newer build can carry a code this one lacks — the
 * migration stream and the static SPA are not promoted at the same instant —
 * and the honest answer is "unknown rank", never a crash and never a blank that
 * reads as "no rank".
 */
export const UNKNOWN_RANK = 'UNKNOWN_RANK';

/**
 * The value the rank control carries for "no rank", and the one the column
 * stores as `null`. A constant rather than an inline `''`, because the screens
 * may hold no string literal of their own (`prijava.test.ts`).
 */
export const NO_RANK = '';

/**
 * The options the rank control offers: no rank first, then the codes in list
 * order. `null` rather than a twelfth code, because "no rank" is the absence
 * the column stores, not a rank.
 */
export const RANK_OPTIONS: readonly (RankCode | null)[] = [null, ...RANK_CODES];

/** Whether a stored value is a code this build knows. */
export function isRankCode(value: string | null): value is RankCode {
  return value !== null && (RANK_CODES as readonly string[]).includes(value);
}

/**
 * A stored rank as this build reads it: a known code, `null` for none, or
 * {@link UNKNOWN_RANK}. Never throws.
 */
export function fireRankOf(value: string | null): RankCode | null | typeof UNKNOWN_RANK {
  if (value === null) return null;

  return isRankCode(value) ? value : UNKNOWN_RANK;
}

/**
 * The message key one stored rank renders as — the only place a code becomes
 * words.
 *
 * `null` IS A CASE: "no rank" is an option the control offers, so it needs a
 * name. A code this build lacks is `ljudi.rank.unknown`, never folded into
 * "no rank", which would state something the row does not say.
 *
 * The return type is the literal union so `t()` type-checks every key against
 * `hr.json`, and it is what `prijava.test.ts` reads to count this module's
 * keys.
 */
export function rankMessageKey(
  rank: string | null,
):
  | 'ljudi.rank.none'
  | 'ljudi.rank.unknown'
  | 'ljudi.rank.trainee'
  | 'ljudi.rank.firefighter'
  | 'ljudi.rank.firefighter1'
  | 'ljudi.rank.nco'
  | 'ljudi.rank.nco1'
  | 'ljudi.rank.seniorNco'
  | 'ljudi.rank.seniorNco1'
  | 'ljudi.rank.officer'
  | 'ljudi.rank.officer1'
  | 'ljudi.rank.seniorOfficer'
  | 'ljudi.rank.seniorOfficer1' {
  const read = fireRankOf(rank);

  if (read === null) return 'ljudi.rank.none';
  if (read === UNKNOWN_RANK) return 'ljudi.rank.unknown';
  if (read === 'trainee') return 'ljudi.rank.trainee';
  if (read === 'firefighter') return 'ljudi.rank.firefighter';
  if (read === 'firefighter_1') return 'ljudi.rank.firefighter1';
  if (read === 'nco') return 'ljudi.rank.nco';
  if (read === 'nco_1') return 'ljudi.rank.nco1';
  if (read === 'senior_nco') return 'ljudi.rank.seniorNco';
  if (read === 'senior_nco_1') return 'ljudi.rank.seniorNco1';
  if (read === 'officer') return 'ljudi.rank.officer';
  if (read === 'officer_1') return 'ljudi.rank.officer1';
  if (read === 'senior_officer') return 'ljudi.rank.seniorOfficer';
  if (read === 'senior_officer_1') return 'ljudi.rank.seniorOfficer1';

  // EXHAUSTIVE over the union `fireRankOf` returns: a twelfth code added to
  // `RANK_CODES` without a branch here is a `pnpm typecheck` failure.
  const unhandled: never = read;

  return unhandled;
}

/** One option's value as the `<select>` carries it. */
export function rankValue(rank: string | null): string {
  return rank ?? NO_RANK;
}

/**
 * The options the EDIT control offers for one stored rank.
 *
 * The fixed list, plus the stored value itself when it is a code this build
 * lacks — rendered as its own "unknown rank" option so the control describes
 * the row honestly and saving the form without touching the rank sends back
 * exactly what the row holds.
 */
export function rankOptionsFor(stored: string | null): readonly (string | null)[] {
  return fireRankOf(stored) === UNKNOWN_RANK ? [stored, ...RANK_OPTIONS] : RANK_OPTIONS;
}

/**
 * What a rank `<select>`'s value IS, given what the row held.
 *
 * A LOOKUP, NEVER A CAST. The empty choice is `null`; a known code is itself;
 * the stored value — including a code this build lacks, which the edit control
 * offers as its own option — is kept as it was. Anything else a DOM could hand
 * back falls back to the stored value, the direction that changes nothing.
 * The create form passes `null` as the stored value, so there an unknown value
 * is simply no rank.
 */
export function chosenRank(value: string, stored: string | null): string | null {
  if (value === NO_RANK) return null;
  if (isRankCode(value)) return value;

  return stored;
}

/** The rank control's initial value for one stored rank: the row, as it is. */
export function rankInitialValue(stored: string | null): string {
  return rankValue(stored);
}

/**
 * What one form save sends for the rank, as a fragment of the edits.
 *
 * THE WHOLE DECISION, executed here rather than written in a `.tsx`:
 *
 *   - NOT OFFERED (the setting off, or no control mounted) → `{}`. The write
 *     leaves the stored rank alone; switching the setting off deletes nothing.
 *   - otherwise `{ fireRank }` from {@link chosenRank}: the empty choice is
 *     `null`, a code is itself, and the stored value — a known code or one
 *     this build lacks — is sent back unchanged, never folded into `null`.
 *
 * The create form passes `null` as the stored rank.
 */
export function rankEditOf(
  stored: string | null,
  value: string | null,
  offered: boolean,
): { readonly fireRank?: string | null } {
  if (!offered || value === null) return {};

  return { fireRank: chosenRank(value, stored) };
}

/**
 * Whether a surface offers or shows ranks at all: only when the organization
 * has switched the setting on. Off, stored ranks survive untouched.
 */
export function ranksShown(organization: { readonly usesFireRanks: boolean } | null): boolean {
  return organization !== null && organization.usesFireRanks;
}

/**
 * The rank text the roster shows beside one member's name, or `null` for
 * none: the setting off, or the member has no rank. A code this build lacks
 * is still shown, as "unknown rank" — in the roster's own LOWERCASE form,
 * because it reads as a noun phrase beside a name, like every rank label.
 */
export function rosterRankMessageKey(
  fireRank: string | null,
  shown: boolean,
):
  | 'smjene.roster.rankUnknown'
  | 'ljudi.rank.trainee'
  | 'ljudi.rank.firefighter'
  | 'ljudi.rank.firefighter1'
  | 'ljudi.rank.nco'
  | 'ljudi.rank.nco1'
  | 'ljudi.rank.seniorNco'
  | 'ljudi.rank.seniorNco1'
  | 'ljudi.rank.officer'
  | 'ljudi.rank.officer1'
  | 'ljudi.rank.seniorOfficer'
  | 'ljudi.rank.seniorOfficer1'
  | null {
  if (!shown || fireRank === null) return null;

  const key = rankMessageKey(fireRank);

  return key === 'ljudi.rank.unknown' || key === 'ljudi.rank.none'
    ? 'smjene.roster.rankUnknown'
    : key;
}

// ------------------------------------------------------------- the setting

/** The setting control's two values. Strings because a `<select>` speaks them. */
export const FIRE_RANKS_ON = 'on';
export const FIRE_RANKS_OFF = 'off';

/** The options the setting control offers, off first: the default. */
export const FIRE_RANKS_OPTIONS: readonly boolean[] = [false, true];

export function fireRanksValue(uses: boolean): string {
  return uses ? FIRE_RANKS_ON : FIRE_RANKS_OFF;
}

/**
 * What the setting control hands back, given what the row holds. A value that
 * is neither option keeps the stored setting — the direction that changes
 * nothing, as {@link chosenRank} takes.
 */
export function fireRanksOf(value: string, stored: boolean): boolean {
  if (value === FIRE_RANKS_ON) return true;
  if (value === FIRE_RANKS_OFF) return false;

  return stored;
}

/**
 * The setting control's React key: the stored value AND a revision that moves
 * on every refused write, so a refusal remounts the uncontrolled control back
 * to what the row holds rather than leaving the refused choice on screen.
 */
export function fireRanksControlKey(uses: boolean, revision: number): string {
  return `${fireRanksValue(uses)}:${String(revision)}`;
}

/** Write the choice now, or hold it until the write in flight settles. */
export const FIRE_RANKS_WRITE = 'write';
export const FIRE_RANKS_QUEUE = 'queue';

/**
 * What a setting change does given what is in flight. ANY write in flight —
 * the form save, the logo upload, the accent, or this setting's own — queues
 * the choice rather than dropping it; the latest choice wins.
 */
export function fireRanksStepOf(
  writingElsewhere: boolean,
  writingSelf: boolean,
): typeof FIRE_RANKS_WRITE | typeof FIRE_RANKS_QUEUE {
  return writingElsewhere || writingSelf ? FIRE_RANKS_QUEUE : FIRE_RANKS_WRITE;
}

/**
 * The queued choice to apply once a write settles, or `undefined` for none.
 * After a REFUSED write the queue is dropped: firing it would clear a refusal
 * nobody has read yet with a write the person made before seeing it.
 */
export function fireRanksFollowUpOf(
  queued: boolean | undefined,
  refused: boolean,
): boolean | undefined {
  return refused ? undefined : queued;
}

/**
 * Whether starting a setting write clears the message region. A write the
 * person just made does; a QUEUED follow-up, applied when another write
 * settled, does not — the region may hold that write's unread outcome.
 */
export function fireRanksClearsFailure(fromQueue: boolean): boolean {
  return !fromQueue;
}

/** The setting's option label. */
export function fireRanksMessageKey(
  uses: boolean,
): 'organization.fireRanksOff' | 'organization.fireRanksOn' {
  return uses ? 'organization.fireRanksOn' : 'organization.fireRanksOff';
}

/**
 * The status line beside the setting: what the row holds, with its subject,
 * so it reads as a sentence rather than a bare "Koriste se".
 */
export function fireRanksStatusMessageKey(
  uses: boolean,
): 'organization.fireRanksStatusOff' | 'organization.fireRanksStatusOn' {
  return uses ? 'organization.fireRanksStatusOn' : 'organization.fireRanksStatusOff';
}
