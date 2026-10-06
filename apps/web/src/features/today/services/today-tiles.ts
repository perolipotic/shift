import { hoursMessageKey, type HoursBandRow, type HoursFigure, type MyHoursSurface } from '@/features/hours/services/my-hours';
import { MY_LEAVE_LOADING, MY_LEAVE_READY, myLeaveMessageKey, type MyLeave } from '@/features/leave/services/my-leave';

/**
 * *Danas*'s two tiles (story 6.1b): the month's hours and the leave balance,
 * each a pure state in a `.ts` that renders nothing (AD-15). The hook only
 * wires them; the node suite executes them.
 *
 * NO FIGURE IS COMPUTED HERE. The hours tile is *Sati*'s own surface
 * (`myHoursSurfaceOf`, the viewer's own month — today's, in the
 * organization's zone) and the leave tile is *Godišnji*'s own state
 * (`myLeaveOf`), each over the same query keys its detail view reads. This
 * module only picks what each tile shows from them, so a tile's figure is
 * its detail view's figure by construction.
 *
 * EACH TILE RESOLVES ON ITS OWN: a skeleton while its reads are pending, its
 * detail view's own unavailable sentence when that view would show it, and
 * otherwise its figures. A tile never waits on the other.
 */

/** A tile's reads are still pending: its skeleton. */
export const TILE_LOADING = 'loading';
/** The detail view would show its unavailable (or unscheduled) sentence: so does the tile. */
export const TILE_UNAVAILABLE = 'unavailable';
/** The tile's figures. */
export const TILE_READY = 'ready';

/** The hours tile's figures: *Sati*'s month, total, bands and conflict count. */
export interface HoursTileFigures {
  /** `Listopad`, capitalized, as *Sati*'s month heading names it. */
  readonly monthName: string;
  /** `2026` */
  readonly year: string;
  readonly total: HoursFigure;
  /** Every band in *Sati*'s order, 0 h bands included. */
  readonly bands: readonly HoursBandRow[];
  /** *Sati*'s conflict count, or `null` when there is none, so the line is not shown. */
  readonly conflictCount: number | null;
}

export type HoursTile =
  | { readonly kind: typeof TILE_LOADING }
  | { readonly kind: typeof TILE_UNAVAILABLE; readonly key: ReturnType<typeof hoursMessageKey> }
  | { readonly kind: typeof TILE_READY; readonly figures: HoursTileFigures };

/** The leave tile's figures: *Godišnji*'s balance, used days and allowance, as the domain gave them. */
export interface LeaveTileFigures {
  /** May be negative: it stays a number. */
  readonly balanceDays: number;
  readonly usedDays: number;
  readonly allowanceDays: number;
}

export type LeaveTile =
  | { readonly kind: typeof TILE_LOADING }
  | { readonly kind: typeof TILE_UNAVAILABLE; readonly key: ReturnType<typeof myLeaveMessageKey> }
  | { readonly kind: typeof TILE_READY; readonly figures: LeaveTileFigures };

/** Both tiles. */
export interface TodayTiles {
  readonly hours: HoursTile;
  readonly leave: LeaveTile;
}

/**
 * The hours tile from *Sati*'s own surface: its message when *Sati* shows
 * one — a failed read, rows that cannot be trusted, or hours the domain
 * refused — the skeleton while *Sati* would show its own, and otherwise the
 * month's figures.
 */
export function hoursTileOf(surface: MyHoursSurface): HoursTile {
  if (surface.refusal !== null) return { kind: TILE_UNAVAILABLE, key: hoursMessageKey(surface.refusal) };

  const view = surface.view;

  if (view === null) return { kind: TILE_LOADING };

  return {
    kind: TILE_READY,
    figures: {
      monthName: view.header.monthName,
      year: view.header.year,
      total: view.total,
      bands: view.bands,
      conflictCount: view.conflictCount,
    },
  };
}

/**
 * The leave tile from *Godišnji*'s own state: the skeleton while it loads,
 * its sentence when it is unavailable or unscheduled, and otherwise the
 * balance with the days used and the allowance.
 */
export function leaveTileOf(leave: MyLeave): LeaveTile {
  if (leave.kind === MY_LEAVE_LOADING) return { kind: TILE_LOADING };
  if (leave.kind !== MY_LEAVE_READY) return { kind: TILE_UNAVAILABLE, key: myLeaveMessageKey(leave.kind) };

  const { balanceDays, usedDays, allowanceDays } = leave.balance;

  return { kind: TILE_READY, figures: { balanceDays, usedDays, allowanceDays } };
}

/** Both tiles, each from its own detail view's state. */
export function todayTilesOf(hours: MyHoursSurface, leave: MyLeave): TodayTiles {
  return { hours: hoursTileOf(hours), leave: leaveTileOf(leave) };
}
