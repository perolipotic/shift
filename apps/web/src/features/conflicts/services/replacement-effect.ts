import { rosterOn, scheduledShiftTypeOn } from '@shift/domain';

import type { CalendarRosterOverride, CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  overrideStandingOfCalendar,
  rosterStandingOfCalendar,
  workingShiftTypeIdsOf,
} from '@/features/calendar/utils/month';
import { REPLACE_MEMBER, type ConflictResolution } from '@/features/conflicts/services/resolutions';

/**
 * WHETHER A REPLACEMENT APPLIES (story 5.5d; human, 2026-10-05), in a `.ts`
 * that renders nothing (AD-15): the one test every surface asks of a
 * `replace_member` resolution's linked roster override.
 *
 * A replacement STOPS COUNTING only when the snapshot holds the override it
 * names (0032's `roster_override_id`) and that override does not apply:
 *
 *   * PENDING — a later rotation save left it out of force
 *     (`rosterStandingOfCalendar`);
 *   * INERT — `rosterOn` does not apply it on its team and date (the
 *     replacement inactive that day, already on the default roster, a
 *     take-off-only override, or the team off that day).
 *
 * Then the shift is really uncovered, and {@link effectiveResolutionsOf}
 * drops the resolution before any key is matched, so the conflict shows again
 * on the queue, the resolution screen, the calendar's marks and *Sati*, for an
 * admin and a member alike. `accept_uncovered` (and every other kind) is
 * untouched.
 *
 * A LINK TO AN OVERRIDE THE SNAPSHOT DOES NOT HOLD IS UNKNOWN, NOT INERT. The
 * snapshot lists live overrides only, so "missing" is either removed — which
 * 0033 ends the resolution with, so a re-read drops it — or written after the
 * snapshot was read (the resolutions re-read can land before the snapshot's,
 * right after `replace_conflict_member`). Either way it keeps counting, so a
 * conflict just resolved never flashes back; {@link unknownReplacementLinksOf}
 * names such links so the surface re-reads the snapshot once
 * (`useReplacementLinkRefresh`). A replacement with no link at all — a
 * member's read from before 0033 — is unknown the same way.
 *
 * A LINK THAT DISAGREES with the override it names on the team or the date
 * (0032 writes both from one key, so this is a broken row) is logged and does
 * not count: one bad row never makes a whole surface unavailable.
 *
 * Nothing here computes a roster in the database (AD-4); the leave screen's
 * replacement guard (5.4e) asks the same question through
 * {@link replacementContextOf} and {@link replacementStandingIn}.
 */

/** What a replacement's link names: the conflict's team and date, and the override. */
export interface ReplacementOverrideLink {
  readonly teamId: string;
  readonly date: string;
  readonly rosterOverrideId: string;
}

/** What is logged when a link disagrees with the override it names: never shown. */
export const REPLACEMENT_LINK_MISMATCH = 'REPLACEMENT_LINK_MISMATCH';

/** The override is live, in force and applied: the replacement counts. */
export const REPLACEMENT_APPLIED = 'applied';
/** The snapshot does not hold the override: unknown, so the replacement keeps counting. */
export const REPLACEMENT_UNKNOWN = 'unknown';
/** The snapshot holds the override, pending or inert: the replacement does not count. */
export const REPLACEMENT_NOT_APPLIED = 'notApplied';
/** The link and the override disagree on the team or the date: a broken row, which does not count. */
export const REPLACEMENT_MISMATCH = 'mismatch';

export type ReplacementStanding =
  | { readonly kind: typeof REPLACEMENT_APPLIED; readonly override: CalendarRosterOverride }
  | { readonly kind: typeof REPLACEMENT_UNKNOWN }
  | { readonly kind: typeof REPLACEMENT_NOT_APPLIED; readonly override: CalendarRosterOverride }
  | { readonly kind: typeof REPLACEMENT_MISMATCH; readonly override: CalendarRosterOverride };

/** A snapshot's answers the test reads, worked out once and reused for every link. */
export interface ReplacementContext {
  readonly snapshot: CalendarSnapshot;
  readonly working: ReadonlySet<string>;
  readonly typeInForce: ReturnType<typeof overrideStandingOfCalendar>['inForce'];
  readonly rosterInForce: ReturnType<typeof rosterStandingOfCalendar>['inForce'];
  readonly overrides: ReadonlyMap<string, CalendarRosterOverride>;
}

/**
 * The context for {@link replacementStandingIn}: the standings, the working
 * types and the live overrides by id, once per snapshot read.
 *
 * @throws RangeError on any precondition of the standings.
 */
export function replacementContextOf(snapshot: CalendarSnapshot): ReplacementContext {
  return {
    snapshot,
    working: new Set(workingShiftTypeIdsOf(snapshot)),
    typeInForce: overrideStandingOfCalendar(snapshot).inForce,
    rosterInForce: rosterStandingOfCalendar(snapshot).inForce,
    overrides: new Map(snapshot.rosterOverrides.map((override) => [override.id, override])),
  };
}

/**
 * Where `link`'s override stands in the context's snapshot. Logs nothing:
 * the caller decides what a mismatch means.
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
export function replacementStandingIn(context: ReplacementContext, link: ReplacementOverrideLink): ReplacementStanding {
  const { snapshot } = context;
  const override = context.overrides.get(link.rosterOverrideId);

  if (override === undefined) return { kind: REPLACEMENT_UNKNOWN };

  // THE LINK AND ITS OVERRIDE MUST AGREE: 0032 writes both from one key.
  if (override.teamId !== link.teamId || override.date !== link.date) return { kind: REPLACEMENT_MISMATCH, override };

  if (override.memberInId === null) return { kind: REPLACEMENT_NOT_APPLIED, override };

  const { teamId, date } = override;
  const scheduled = scheduledShiftTypeOn(
    snapshot.assignments.filter((assignment) => assignment.teamId === teamId),
    snapshot.steps,
    context.typeInForce,
    teamId,
    date,
  );

  if (scheduled === null || !context.working.has(scheduled.shiftTypeId)) return { kind: REPLACEMENT_NOT_APPLIED, override };

  const applied = rosterOn(snapshot.members, context.rosterInForce, teamId, date).applied;

  return applied.some((one) => one.id === override.id)
    ? { kind: REPLACEMENT_APPLIED, override }
    : { kind: REPLACEMENT_NOT_APPLIED, override };
}

/**
 * The override `link` names when it is live, in force and applied on a
 * working shift of its team and date; `null` otherwise — unknown, pending,
 * inert or a mismatch alike.
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
export function appliedReplacementOverrideOf(
  snapshot: CalendarSnapshot,
  link: ReplacementOverrideLink,
): CalendarRosterOverride | null {
  const standing = replacementStandingIn(replacementContextOf(snapshot), link);

  return standing.kind === REPLACEMENT_APPLIED ? standing.override : null;
}

/** Whether `resolution` still decides its conflict, in `context`: every kind but a replacement the snapshot holds unapplied. */
function countsIn(context: ReplacementContext, resolution: ConflictResolution): boolean {
  if (resolution.kind !== REPLACE_MEMBER || resolution.rosterOverrideId === null) return true;

  const standing = replacementStandingIn(context, {
    teamId: resolution.teamId,
    date: resolution.date,
    rosterOverrideId: resolution.rosterOverrideId,
  });

  if (standing.kind === REPLACEMENT_MISMATCH) {
    console.error(REPLACEMENT_LINK_MISMATCH, standing.override.id);

    return false;
  }

  return standing.kind !== REPLACEMENT_NOT_APPLIED;
}

/**
 * The resolutions that still decide their conflict, in the order given:
 * every kind but `replace_member` as it is, and a `replace_member` unless the
 * snapshot holds its override pending or inert, or the link disagrees with it
 * (logged). A link the snapshot does not hold, and no link at all, count.
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
export function effectiveResolutionsOf<Resolution extends ConflictResolution>(
  snapshot: CalendarSnapshot,
  resolutions: readonly Resolution[],
): readonly Resolution[] {
  if (!resolutions.some((resolution) => resolution.kind === REPLACE_MEMBER)) return resolutions;

  const context = replacementContextOf(snapshot);

  return resolutions.filter((resolution) => countsIn(context, resolution));
}

/**
 * Whether `resolution` is a replacement the snapshot holds and does not
 * apply (story 5.5d): pending, inert or a broken link — what keeps a
 * conflict's key HELD while the conflict shows again. A link the snapshot
 * does not hold is unknown, never held.
 *
 * @throws RangeError on any precondition of the domain's derivation.
 */
export function heldByReplacement(snapshot: CalendarSnapshot, resolution: ConflictResolution): boolean {
  if (resolution.kind !== REPLACE_MEMBER || resolution.rosterOverrideId === null) return false;

  const standing = replacementStandingIn(replacementContextOf(snapshot), {
    teamId: resolution.teamId,
    date: resolution.date,
    rosterOverrideId: resolution.rosterOverrideId,
  });

  return standing.kind === REPLACEMENT_NOT_APPLIED || standing.kind === REPLACEMENT_MISMATCH;
}

const KIND_COLUMN = 'kind';
const LINK_COLUMN = 'roster_override_id';

/**
 * The override ids that `replace_member` rows link and the snapshot does not
 * hold, sorted and once each — the fetch-skew case a surface re-reads the
 * snapshot for. Reads the rows as they came back, unparsed, and never
 * throws: what cannot be read names nothing.
 */
export function unknownReplacementLinksOf(snapshot: CalendarSnapshot, rows: readonly unknown[]): readonly string[] {
  const held = new Set(snapshot.rosterOverrides.map((override) => override.id));
  const unknown = new Set<string>();

  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;

    const record = row as Record<string, unknown>;
    const link = record[LINK_COLUMN];

    if (record[KIND_COLUMN] === REPLACE_MEMBER && typeof link === 'string' && link !== '' && !held.has(link)) unknown.add(link);
  }

  return [...unknown].sort();
}
