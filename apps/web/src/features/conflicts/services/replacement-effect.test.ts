import { afterEach, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { rosterStandingOfCalendar } from '@/features/calendar/utils/month';
import {
  REPLACEMENT_LINK_MISMATCH,
  appliedReplacementOverrideOf,
  effectiveResolutionsOf,
  heldByReplacement,
  unknownReplacementLinksOf,
} from '@/features/conflicts/services/replacement-effect';
import { ACCEPT_UNCOVERED, REPLACE_MEMBER, type ConflictResolution } from '@/features/conflicts/services/resolutions';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membershipRow,
  membersAnswerOf,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  statusRow,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.5d's one test, executed (AD-15): a `replace_member` resolution
 * counts only while its linked override is live, in force and applied on a
 * working shift; every other kind passes through untouched.
 */

// On 2026-09-10 the pilot's Smjena A works Dan; on the 12th A is off.
const DINO = '00000000-0000-4000-8000-0000000000e2';
const KARLO = '00000000-0000-4000-8000-0000000000e5';
const TEAM_A = 'pilot-smjena-a';
const TEAM_B = 'pilot-smjena-b';

/** The viewer and Karlo on A, Dino on no team — inactive from `dinoInactiveFrom` when given. */
async function snapshotOf(
  rosterOverrides: readonly Record<string, unknown>[],
  dinoInactiveFrom: string | null = null,
  typeOverrides: readonly Record<string, unknown>[] = [],
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(TEAM_A, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, TEAM_A, SEEDED), memberMembershipRow(KARLO, TEAM_A, SEEDED)],
          statuses: dinoInactiveFrom === null ? [] : [statusRow(DINO, false, dinoInactiveFrom)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(DINO, 'Dino Grgić'),
      calendarMemberRow(KARLO, 'Karlo Jelić'),
    ]),
    overridesAnswerOf(typeOverrides),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

const DINO_10 = calendarRosterOverrideRow('ro-dino-10', TEAM_A, '2026-09-10', null, DINO);
// Written before the seeded rotation's stamp, so that assignment is newer: pending review.
const DINO_10_PENDING = calendarRosterOverrideRow('ro-dino-10', TEAM_A, '2026-09-10', null, DINO, {
  createdAt: '2019-01-01T00:00:00+00:00',
});

afterEach(() => {
  vi.restoreAllMocks();
});

const replaced = (rosterOverrideId: string | null, date = '2026-09-10', teamId = TEAM_A): ConflictResolution => ({
  memberId: VIEWER_MEMBER,
  date,
  teamId,
  kind: REPLACE_MEMBER,
  rosterOverrideId,
});
const accepted = (date: string): ConflictResolution => ({
  memberId: VIEWER_MEMBER,
  date,
  teamId: TEAM_A,
  kind: ACCEPT_UNCOVERED,
  rosterOverrideId: null,
});

describe('whether a replacement applies (story 5.5d)', () => {
  it('Effective: an applied override keeps its resolution, and names the override', async () => {
    const snapshot = await snapshotOf([DINO_10]);
    const resolutions = [replaced('ro-dino-10')];

    expect(appliedReplacementOverrideOf(snapshot, { teamId: TEAM_A, date: '2026-09-10', rosterOverrideId: 'ro-dino-10' })?.id).toBe(
      'ro-dino-10',
    );
    expect(effectiveResolutionsOf(snapshot, resolutions)).toEqual(resolutions);
    expect(heldByReplacement(snapshot, replaced('ro-dino-10'))).toBe(false);
  });

  it('Pending after rotation save: an override older than its team\'s newest assignment counts for nothing, and holds its key', async () => {
    const snapshot = await snapshotOf([DINO_10_PENDING]);

    expect(rosterStandingOfCalendar(snapshot).inForce).toEqual([]);
    expect(effectiveResolutionsOf(snapshot, [replaced('ro-dino-10')])).toEqual([]);
    expect(heldByReplacement(snapshot, replaced('ro-dino-10'))).toBe(true);
  });

  it('Inert replacement: deactivated by then, or already on the roster, counts for nothing', async () => {
    const deactivated = await snapshotOf([DINO_10], '2026-09-01');

    expect(effectiveResolutionsOf(deactivated, [replaced('ro-dino-10')])).toEqual([]);
    expect(heldByReplacement(deactivated, replaced('ro-dino-10'))).toBe(true);

    const already = await snapshotOf([calendarRosterOverrideRow('ro-karlo', TEAM_A, '2026-09-10', null, KARLO)]);

    expect(effectiveResolutionsOf(already, [replaced('ro-karlo')])).toEqual([]);
  });

  it('counts for nothing on a day the team is off, or once a shift-type override makes the day non-working', async () => {
    const off = await snapshotOf([calendarRosterOverrideRow('ro-dino-12', TEAM_A, '2026-09-12', null, DINO)]);

    expect(effectiveResolutionsOf(off, [replaced('ro-dino-12', '2026-09-12')])).toEqual([]);

    const madeOff = await snapshotOf([DINO_10], null, [
      calendarOverrideRow('type-off-10', TEAM_A, '2026-09-10', 'pilot-slobodno', { createdAt: '2026-09-13T08:00:00+00:00' }),
    ]);

    expect(effectiveResolutionsOf(madeOff, [replaced('ro-dino-10')])).toEqual([]);
  });

  it('counts for nothing when its override only takes someone off', async () => {
    const snapshot = await snapshotOf([calendarRosterOverrideRow('ro-off', TEAM_A, '2026-09-10', KARLO, null)]);

    expect(effectiveResolutionsOf(snapshot, [replaced('ro-off')])).toEqual([]);
  });

  it('Fetch skew: a link to an override the snapshot does not hold is unknown, keeps counting, holds nothing, and is named for a re-read', async () => {
    const snapshot = await snapshotOf([DINO_10]);
    const unknown = [replaced('ro-written-later')];

    expect(effectiveResolutionsOf(snapshot, unknown)).toEqual(unknown);
    expect(heldByReplacement(snapshot, replaced('ro-written-later'))).toBe(false);
    expect(
      unknownReplacementLinksOf(snapshot, [
        { kind: 'replace_member', roster_override_id: 'ro-z' },
        { kind: 'replace_member', roster_override_id: 'ro-dino-10' },
        { kind: 'replace_member', roster_override_id: 'ro-a' },
        { kind: 'replace_member', roster_override_id: 'ro-z' },
        { kind: 'accept_uncovered', roster_override_id: 'ro-b' },
        null,
        'row',
      ]),
    ).toEqual(['ro-a', 'ro-z']);
  });

  it('counts a replacement with no link — a member\'s read from before 0033 — as unknown', async () => {
    const snapshot = await snapshotOf([DINO_10_PENDING]);

    expect(effectiveResolutionsOf(snapshot, [replaced(null)])).toEqual([replaced(null)]);
  });

  it('Accept unaffected: every other kind passes through, in order, beside the replacements judged', async () => {
    const snapshot = await snapshotOf([DINO_10_PENDING, calendarRosterOverrideRow('ro-dino-11', TEAM_A, '2026-09-11', null, DINO)]);
    const first = accepted('2026-09-13');
    const kept = replaced('ro-dino-11', '2026-09-11');
    const last = accepted('2026-09-14');

    expect(effectiveResolutionsOf(snapshot, [first, replaced('ro-dino-10'), kept, last])).toEqual([first, kept, last]);

    const none = [accepted('2026-09-11')];

    expect(effectiveResolutionsOf(await snapshotOf([]), none)).toBe(none);
  });

  it('logs a link that disagrees with its override, and counts it for nothing, never throwing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const snapshot = await snapshotOf([DINO_10]);

    expect(effectiveResolutionsOf(snapshot, [replaced('ro-dino-10', '2026-09-10', TEAM_B)])).toEqual([]);
    expect(effectiveResolutionsOf(snapshot, [replaced('ro-dino-10', '2026-09-11')])).toEqual([]);
    expect(logged).toHaveBeenCalledWith(REPLACEMENT_LINK_MISMATCH, 'ro-dino-10');
    expect(appliedReplacementOverrideOf(snapshot, { teamId: TEAM_B, date: '2026-09-10', rosterOverrideId: 'ro-dino-10' })).toBeNull();
  });
});
