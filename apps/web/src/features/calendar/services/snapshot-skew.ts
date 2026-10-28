import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import type { MemberRole } from '@/features/navigation/utils/destinations';

/**
 * ROWS NEWER THAN THE SNAPSHOT ARE A SKEW, NOT A BREAK (story 5.5d's edge
 * case), as a pure rule in a `.ts` that renders nothing (AD-15). The leave
 * and resolution reads can land after a member or team was added and before
 * the cached calendar snapshot is read again; their rows then name an id the
 * snapshot does not hold yet. Every surface that parses those rows against
 * the snapshot — the calendar's marks, *Za odluku*, *Sati* and *Danas* — asks
 * this module first: such rows are unavailable WITH the retry, and loading
 * while the snapshot is being read again (`useSnapshotSkewRefresh` re-reads
 * it once by itself), never the parsers' refusal of a row that cannot be
 * trusted. The rows are never dropped: a row the snapshot cannot place may
 * still be a conflict on the new member's or team's shift.
 *
 * Apart from `./marks` so the conflicts queue, which the marks derive
 * through, can ask it with no import cycle.
 */

/** The role that reads every member's leave and resolutions. */
const ADMIN_ROLE: MemberRole = 'admin';

/** Whether the viewer reads the organization's records — an admin — rather than their own. */
export function readsOrganizationLeave(role: MemberRole): boolean {
  return role === ADMIN_ROLE;
}

/** The member a leave or resolution row names. */
const MEMBER_COLUMN = 'member_id';
/** The team a resolution row names. */
const TEAM_COLUMN = 'team_id';

/** The text at `column` of a row that is a record, or `null`: anything else is the parser's to refuse. */
function idAt(row: unknown, column: string): string | null {
  if (typeof row !== 'object' || row === null) return null;

  const value = (row as Record<string, unknown>)[column];

  return typeof value === 'string' ? value : null;
}

/**
 * The ids the leave and resolution rows name that `snapshot` does not hold —
 * `member:<id>` and `team:<id>`, sorted and distinct — so a skew between the
 * reads is told apart from a row that cannot be trusted. A member's own rows
 * always name the viewer, so only their resolutions' teams can be newer than
 * the snapshot. STORY 9.5: an admin's leave request rows too — `calendar_members`
 * answers inactive members as well, so a request naming a member the snapshot
 * lacks is a snapshot older than the member, never a member who is gone.
 */
export function unknownSnapshotIdsOf(
  snapshot: CalendarSnapshot,
  leaveRows: readonly unknown[] | undefined,
  resolutionRows: readonly unknown[] | undefined,
  requestRows?: readonly unknown[] | undefined,
): readonly string[] {
  const admin = readsOrganizationLeave(snapshot.viewer.role);
  const members = new Set(snapshot.members.map((member) => member.id));
  const teams = new Set(snapshot.teams.map((team) => team.id));
  const unknown = new Set<string>();

  for (const row of admin ? [...(leaveRows ?? []), ...(resolutionRows ?? []), ...(requestRows ?? [])] : []) {
    const memberId = idAt(row, MEMBER_COLUMN);

    if (memberId !== null && !members.has(memberId)) unknown.add(`member:${memberId}`);
  }

  for (const row of resolutionRows ?? []) {
    const teamId = idAt(row, TEAM_COLUMN);

    if (teamId !== null && !teams.has(teamId)) unknown.add(`team:${teamId}`);
  }

  return [...unknown].sort();
}

/** No id the snapshot lacks: {@link snapshotSkewOf}'s answer when nothing needs reading again. */
export const NO_SKEW = '';

/**
 * {@link unknownSnapshotIdsOf} as one text — {@link NO_SKEW} for none or no
 * snapshot yet — so the re-read asks once for each distinct set.
 */
export function snapshotSkewOf(
  snapshot: CalendarSnapshot | null,
  leaveRows: readonly unknown[] | undefined,
  resolutionRows: readonly unknown[] | undefined,
  requestRows?: readonly unknown[] | undefined,
): string {
  return snapshot === null ? NO_SKEW : unknownSnapshotIdsOf(snapshot, leaveRows, resolutionRows, requestRows).join(' ');
}
