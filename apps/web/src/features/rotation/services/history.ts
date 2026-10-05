import { formatDate, formatIsoDate, formatTime } from '@/lib/i18n/format';
import {
  assignmentInForceOf,
  rotationScheduledDateOf,
  rotationTeamsOf,
  type RotationHistoryRecord,
  type RotationSnapshot,
} from '@/features/rotation/services/list';

/**
 * `Povijest rotacije` — every saved change of the rotation, who saved it and
 * when (story 2.6, CAP-9, AD-11). Pure: it renders nothing and reads nothing
 * but the one snapshot.
 *
 * ONE ROW PER SAVED CHANGE. A save writes one assignment per active team, all
 * on one new pattern and one effective date, so the versions are grouped by
 * `(pattern, effective date)`; the row counts the teams in the group. Newest
 * first: by effective date, then by when it was saved.
 *
 * THE STATUS IS WORDS, never colour alone: `zakazano` after today, `na snazi`
 * while one of its versions is a team's version in force today (the domain's
 * `rotationAssignmentOn`, through `assignmentInForceOf`), `prethodno`
 * otherwise.
 *
 * THE AUTHOR is `created_by` joined on the client to the members' auth user
 * ids (no key joins them in the schema). A saver the members embed lacks is
 * `null`, and the screen says so through its own key.
 */

export const HISTORY_SCHEDULED = 'scheduled';
export const HISTORY_IN_FORCE = 'inForce';
export const HISTORY_PREVIOUS = 'previous';

export type RotationHistoryStatus = typeof HISTORY_SCHEDULED | typeof HISTORY_IN_FORCE | typeof HISTORY_PREVIOUS;

/** One saved change, as the history lists it. */
export interface RotationHistoryRow {
  /** Stable per change: the pattern and the effective date. */
  readonly key: string;
  readonly effectiveFrom: string;
  /** `03.10.2026`, through the format layer. */
  readonly effectiveLabel: string;
  /** The saving admin's name, or `null` when the members embed does not know them. */
  readonly author: string | null;
  /** When it was saved, in the organization's zone: `26.09.2026` and `20:07`. */
  readonly savedDate: string;
  readonly savedTime: string;
  readonly status: RotationHistoryStatus;
  /** How many teams the change binds. */
  readonly teamCount: number;
}

function latestOf(records: readonly RotationHistoryRecord[]): RotationHistoryRecord {
  return records.reduce((latest, record) =>
    Date.parse(record.createdAt) > Date.parse(latest.createdAt) ? record : latest,
  );
}

/** Every saved change of `snapshot`'s rotation, newest first, as of the organization's `today`. */
export function rotationHistoryOf(snapshot: RotationSnapshot, today: string): readonly RotationHistoryRow[] {
  const groups = new Map<string, RotationHistoryRecord[]>();

  for (const record of snapshot.history) {
    const key = `${record.patternId}:${record.effectiveFrom}`;
    const group = groups.get(key);

    if (group === undefined) groups.set(key, [record]);
    else group.push(record);
  }

  const names = new Map(snapshot.authors.map((author) => [author.authUserId, author.name]));
  const inForce = (record: RotationHistoryRecord): boolean =>
    assignmentInForceOf(snapshot, record.teamId, today)?.effectiveFrom === record.effectiveFrom;

  const rows = [...groups.entries()].map(([key, records]) => {
    const latest = latestOf(records);
    const saved = new Date(latest.createdAt);
    const status: RotationHistoryStatus =
      latest.effectiveFrom > today ? HISTORY_SCHEDULED : records.some(inForce) ? HISTORY_IN_FORCE : HISTORY_PREVIOUS;

    const row: RotationHistoryRow = {
      key,
      effectiveFrom: latest.effectiveFrom,
      effectiveLabel: formatIsoDate(latest.effectiveFrom) ?? latest.effectiveFrom,
      author: names.get(latest.createdBy) ?? null,
      savedDate: formatDate(saved, snapshot.timeZone),
      savedTime: formatTime(saved, snapshot.timeZone),
      status,
      teamCount: new Set(records.map((record) => record.teamId)).size,
    };

    return { row, savedMs: saved.getTime() };
  });

  rows.sort((one, other) =>
    one.row.effectiveFrom === other.row.effectiveFrom
      ? other.savedMs - one.savedMs
      : one.row.effectiveFrom < other.row.effectiveFrom
        ? 1
        : -1,
  );

  return rows.map(({ row }) => row);
}

// ------------------------------------------------------------ the messages

/** The words a status renders as. Exhaustive. */
export function rotationHistoryStatusMessageKey(
  status: RotationHistoryStatus,
):
  | 'rotation.builder.history.status.scheduled'
  | 'rotation.builder.history.status.inForce'
  | 'rotation.builder.history.status.previous' {
  switch (status) {
    case HISTORY_SCHEDULED:
      return 'rotation.builder.history.status.scheduled';
    case HISTORY_IN_FORCE:
      return 'rotation.builder.history.status.inForce';
    case HISTORY_PREVIOUS:
      return 'rotation.builder.history.status.previous';
    default: {
      const unhandled: never = status;

      return unhandled;
    }
  }
}

/** What an author the members embed does not know renders as. */
export function rotationHistoryAuthorMessageKey(): 'rotation.builder.history.unknownAuthor' {
  return 'rotation.builder.history.unknownAuthor';
}

// ---------------------------------------------------------------- the cancel

/** The change scheduled after `today`, as the cancel's prompt names it. */
export interface ScheduledChange {
  readonly effectiveFrom: string;
  /** `03.10.2026`, through the format layer. */
  readonly label: string;
}

/** The change scheduled after `today`, or `null` while none is — what the cancel is offered for. */
export function scheduledChangeOf(snapshot: RotationSnapshot, today: string): ScheduledChange | null {
  const effectiveFrom = rotationScheduledDateOf(snapshot, today);

  return effectiveFrom === null ? null : { effectiveFrom, label: formatIsoDate(effectiveFrom) ?? effectiveFrom };
}

// ---------------------------------------------------------- the save bar

/**
 * The save bar's hint (story 5.5c): when the draft would apply from, and
 * since when the rotation governing today has been in force.
 */
export interface SaveBarHint {
  /** The draft's `Vrijedi od`, `01.11.2026`, through the format layer. */
  readonly effectiveLabel: string;
  /**
   * The effective date of the version in force today, `01.01.2020`; `null`
   * while no active team has one.
   */
  readonly inForceLabel: string | null;
}

/**
 * The effective date of the version governing `today`: per active team the
 * version in force (`assignmentInForceOf`), and across teams THE NEWEST of
 * those dates — explicitly, never by any list's sort order. `null` while no
 * active team has a version in force.
 */
export function inForceFromOf(snapshot: RotationSnapshot, today: string): string | null {
  let newest: string | null = null;

  for (const team of rotationTeamsOf(snapshot)) {
    const version = assignmentInForceOf(snapshot, team.id, today);

    if (version !== null && version.effectiveFrom <= today && (newest === null || version.effectiveFrom > newest)) {
      newest = version.effectiveFrom;
    }
  }

  return newest;
}

/**
 * The hint the save bar shows, or `null`: with no unsaved changes, and with
 * a `Vrijedi od` that is empty or not a date — never "Promjena vrijedi od .".
 */
export function saveBarHintOf(
  unsaved: boolean,
  snapshot: RotationSnapshot,
  today: string,
  effectiveFrom: string,
): SaveBarHint | null {
  if (!unsaved) return null;

  const effectiveLabel = formatIsoDate(effectiveFrom);

  if (effectiveLabel === null) return null;

  const inForce = inForceFromOf(snapshot, today);

  return { effectiveLabel, inForceLabel: inForce === null ? null : (formatIsoDate(inForce) ?? inForce) };
}
