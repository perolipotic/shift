import type { RefObject } from 'react';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import type { ErasureReadsHook } from '@/features/conflicts/hooks/use-erasure-reads';
import type { MemberListRow } from '@/features/members/services/list';
import type { MemberChange } from '@/features/members/services/member-erasures';
import type {
  MemberFormState,
  StatusChangeOffer,
  TeamMoveOffer,
  TeamPositionsSetting,
} from '@/features/members/services/write';
import type { TeamRow } from '@/features/teams/services/list';

/**
 * What `/ljudi/$id`'s card hooks share (epics 5–7 retro A16, A21): the one
 * screen `useMemberEdit` reads and hands each card's hook — basics, team,
 * status and sign-in — so no card reads a second time, and the types their
 * dialogs and erasure confirmations hold.
 */

/**
 * What a card's erasure check stood on (story 5.5e): the member it is about,
 * the card's own confirmation — so a re-check, a retry and the write still
 * have it once that confirmation has closed — and the change derived from it.
 */
export interface CheckedMemberChange<Confirmation> {
  readonly member: string;
  readonly confirmation: Confirmation;
  readonly change: MemberChange;
}

/**
 * One opening of a dialog (story 7.11): a fresh key, so each opening renders
 * its body anew from the record as it is now, and — for a dialog whose offer
 * can change under it — what it was opened on (`held`), so a re-read neither
 * relabels it nor remounts its controls under the admin's hand: an offer that
 * still stands keeps the dialog as it is, and one that is gone closes it.
 */
export interface DialogOpening<Held = null> {
  readonly key: number;
  readonly held: Held;
}

/** What the team dialog was opened on: the move offered, and the history it was offered against. */
export interface HeldTeamMove {
  readonly offer: TeamMoveOffer;
  readonly history: string;
  readonly name: string;
}

/** What the status dialog was opened on. */
export interface HeldStatusChange {
  readonly offer: StatusChangeOffer;
  readonly name: string;
  /** When it was opened (epoch ms): a deactivation names only requests read after it (0041). */
  readonly openedAt: number;
}

/** The screen as last drawn, read after an await (story 5.5e). */
export interface LatestMemberScreen {
  readonly member: MemberListRow | null;
  readonly today: string | null;
  readonly teams: readonly TeamRow[] | null;
  readonly members: readonly MemberListRow[];
  readonly caller: string | null;
}

/** The member page's reads, as every card's hook takes them from `useMemberEdit`. */
export interface MemberScreen {
  /** The route's member. */
  readonly id: string;
  /** Counts openings, so every opening of any dialog gets a key of its own. */
  readonly openings: RefObject<number>;
  readonly form: MemberFormState;
  /** The organization's today, from the zone the one list read embeds. */
  readonly today: string | null;
  readonly organizationMembers: readonly MemberListRow[];
  /** The teams, writable: `null` while the read is refused. */
  readonly allTeams: readonly TeamRow[] | null;
  readonly activeTeams: readonly TeamRow[] | null;
  readonly callerAuthUserId: string | null;
  readonly offersRank: boolean;
  readonly positionsSetting: TeamPositionsSetting;
  readonly offersPosition: boolean;
  /** The calendar snapshot the page observes, for the team and status dialogs. */
  readonly calendarSnapshot: CalendarSnapshot | null;
  /** The screen as last drawn, for an erasure dialog's save after its await. */
  readonly latest: RefObject<LatestMemberScreen>;
  /** The three fresh reads every erasure check stands on. */
  readonly readErasures: ErasureReadsHook;
}

/** The element whose id this is, for a focus that has nowhere better to go. */
export function byId(id: string): () => HTMLElement | null {
  return () => document.getElementById(id);
}
