/**
 * THE FRESHNESS RULE (story 8.2, AD-13's offline clause): which of a
 * surface's reads may be drawn, decided for ALL of them together, as a pure
 * rule in a `.ts` that renders nothing (AD-15).
 *
 * The query cache is persisted to the device (`./persistence`), so a cached
 * answer can be one this page load never read from the network. Two clocks
 * decide what that answer may do:
 *
 *   - ONLINE, a read counts as fresh only if it landed after `freshAfter`:
 *     the moment the app started, moved forward on every offline→online
 *     transition. While any read is older than that, no fresh figure is
 *     drawn, and WHERE `freshAfter` CAME FROM decides what is drawn instead:
 *       - after the APP START (a cache restored from the device), the
 *         skeleton — the restored data is never drawn online;
 *       - after a RECONNECT, the whole cached snapshot stays, under its
 *         as-of note, until every read is newer than the reconnect, and the
 *         surface then switches to the fresh render all at once — so a brief
 *         signal loss closes no open dialog (human decision 2026-10-20,
 *         option d). With any read missing, the skeleton.
 *   - OFFLINE, the surface renders its WHOLE cached snapshot when every read
 *     has data, under one note whose time is the OLDEST read's
 *     `dataUpdatedAt`. If any read has nothing, the surface is unavailable.
 *     Never a cached figure beside a missing one.
 *
 * {@link snapshotFreshnessOf} decides the surface's state;
 * {@link snapshotAnswerOf} presents each read as the existing derivations
 * expect it, so they keep their own rules: a settled answer offline, the
 * pending shape while a read is too old, and the raw answer otherwise. The
 * hooks of *Danas* and *Kalendar* route every read through both. The other
 * surfaces keep the old rule (a paused read is unavailable) until story 8.2b.
 */

/** TanStack Query's name for a fetch in flight. */
export const FETCH_FETCHING = 'fetching';
/** TanStack Query's name for no fetch at all. */
export const FETCH_IDLE = 'idle';

/** Every read is from this session's network: the surface renders as it always has. */
export const FRESHNESS_FRESH = 'fresh';
/** Online, and some read is older than `freshAfter` (after the app start, or a reconnect with a read missing): the skeleton. */
export const FRESHNESS_LOADING = 'loading';
/**
 * Offline with every read cached, or just reconnected with every read cached
 * and some not yet read again: the whole snapshot, under the as-of note.
 */
export const FRESHNESS_OFFLINE = 'offline';
/** Offline with a read missing, or online with a read that failed: the existing unavailable state. */
export const FRESHNESS_UNAVAILABLE = 'unavailable';

export type SnapshotFreshness =
  | { readonly kind: typeof FRESHNESS_FRESH }
  | { readonly kind: typeof FRESHNESS_LOADING }
  | {
      readonly kind: typeof FRESHNESS_OFFLINE;
      /** The oldest read's `dataUpdatedAt`, in epoch milliseconds: what the note states. */
      readonly asOf: number;
    }
  | { readonly kind: typeof FRESHNESS_UNAVAILABLE };

/** One read, as far as freshness looks at it. A query that was never created has no data and time 0. */
export interface SnapshotRead {
  readonly data: unknown;
  readonly dataUpdatedAt: number;
  readonly isError: boolean;
  readonly fetchStatus: string;
}

/** Whether a read failed and is not being read again. */
export function failed(read: Pick<SnapshotRead, 'isError' | 'fetchStatus'>): boolean {
  return read.isError && read.fetchStatus !== FETCH_FETCHING;
}

/**
 * The surface's state from all of its reads together.
 *
 * Offline: the whole snapshot when every read has data and none failed, its
 * time the oldest read's; unavailable otherwise. Online: unavailable when a read failed (the
 * existing state, with its retry); while any read is older than `freshAfter`
 * (a pending first read has time 0, so it is older too), the whole cached
 * snapshot when `freshAfter` is a `reconnected` one and every read has data,
 * and loading otherwise; fresh once every read is newer. An empty list is
 * fresh online and unavailable offline: a surface with no read has nothing
 * cached to show.
 */
export function snapshotFreshnessOf(
  reads: readonly SnapshotRead[],
  freshAfter: number,
  online: boolean,
  reconnected = false,
): SnapshotFreshness {
  const whole = reads.length > 0 && reads.every((read) => read.data !== undefined);
  const cached = (): SnapshotFreshness => ({
    kind: FRESHNESS_OFFLINE,
    asOf: Math.min(...reads.map((read) => read.dataUpdatedAt)),
  });

  // A FAILURE SHOWS NO GRID offline either: a refetch that failed over old
  // data (in flight when the connection dropped) is the unavailable state,
  // never that old data under a note.
  if (!online) return whole && !reads.some(failed) ? cached() : { kind: FRESHNESS_UNAVAILABLE };

  if (reads.some(failed)) return { kind: FRESHNESS_UNAVAILABLE };
  if (reads.some((read) => read.dataUpdatedAt < freshAfter)) {
    return reconnected && whole ? cached() : { kind: FRESHNESS_LOADING };
  }

  return { kind: FRESHNESS_FRESH };
}

/** The note's zone is the calendar snapshot's: it comes with the snapshot, which is never drawn without it. */
export const NOTE_ZONE_CALENDAR = 'calendar';
/** The note's zone is resolved from the surface's reads (the organization snapshot, or a zone a read carries). */
export const NOTE_ZONE_READS = 'reads';
/** No note is needed: nothing cached is drawn as figures (a read that resolved with its own refusal). */
export const NOTE_ZONE_NONE = 'none';

/**
 * Where a surface's as-of note takes its zone from (story 8.2b): the calendar
 * snapshot, the surface's reads — `zone` the one resolved, `null` for none —
 * or nowhere, because what is drawn is a refusal rather than a snapshot.
 */
export type NoteZone =
  | { readonly from: typeof NOTE_ZONE_CALENDAR }
  | { readonly from: typeof NOTE_ZONE_READS; readonly zone: string | null }
  | { readonly from: typeof NOTE_ZONE_NONE };

/** The calendar-sourced zone, for the surfaces that read the calendar snapshot. */
export const ZONE_FROM_CALENDAR: NoteZone = { from: NOTE_ZONE_CALENDAR };
/** No zone needed: a refusal is drawn, never a snapshot. */
export const ZONE_NOT_NEEDED: NoteZone = { from: NOTE_ZONE_NONE };

/** The zone resolved from a surface's reads, `null` for none. */
export function zoneFromReads(zone: string | null): NoteZone {
  return { from: NOTE_ZONE_READS, zone };
}

/**
 * The surface's state once its note's zone is known (story 8.2b): a cached
 * snapshot is never drawn without its note, and the note states its time only
 * in the organization's zone. So the whole snapshot whose zone comes from its
 * reads and resolved to NONE is the unavailable state; a calendar-sourced
 * zone (it comes with the snapshot) and a surface that needs none leave the
 * state as it is, as does every state but the whole cached snapshot.
 */
export function notedFreshnessOf(freshness: SnapshotFreshness, noteZone: NoteZone): SnapshotFreshness {
  return freshness.kind === FRESHNESS_OFFLINE && noteZone.from === NOTE_ZONE_READS && noteZone.zone === null
    ? { kind: FRESHNESS_UNAVAILABLE }
    : freshness;
}

/** What the as-of note states: when the drawn snapshot is from, and the organization's zone to state it in. */
export interface OfflineNoteFacts {
  /** The oldest read's `dataUpdatedAt`, in epoch milliseconds. */
  readonly asOf: number;
  readonly timeZone: string;
}

/**
 * THE ONE GATE FOR THE AS-OF NOTE (story 8.2b): whenever the surface draws
 * its whole cached snapshot (`offline`) and is not in its own unavailable
 * state — whatever else it renders: an empty list, no team, a search with no
 * match, a refusal of one month — the note stands, in `timeZone`. With no
 * zone, none (and `notedFreshnessOf` has made such a surface unavailable
 * already, unless it draws a refusal rather than a snapshot).
 */
export function offlineNoteOf(
  freshness: SnapshotFreshness,
  timeZone: string | null,
  unavailable: boolean,
): OfflineNoteFacts | null {
  return freshness.kind === FRESHNESS_OFFLINE && !unavailable && timeZone !== null
    ? { asOf: freshness.asOf, timeZone }
    : null;
}

/** A query result as the existing surface derivations read it. */
export interface ReadAnswer<Data> {
  readonly data: Data | undefined;
  readonly dataUpdatedAt: number;
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly fetchStatus: string;
}

/**
 * One read as the surface's derivations should see it, under the surface's
 * `freshness` and the `clock` it was decided at:
 *
 *   - THE WHOLE CACHED SNAPSHOT (offline, or just reconnected): settled —
 *     its data, no error, no fetch — so a paused refetch or a refetch in
 *     flight over cached data is drawn rather than refused or pulsed.
 *   - OFFLINE, anything else: failed with no data, so every part of the
 *     surface shows the existing unavailable state and none draws a cached
 *     figure beside a missing one.
 *   - ONLINE: a failed read and a read with no data stay as they are (the
 *     existing unavailable and loading states); any other read older than
 *     `freshAfter` is pending with no data, so its old answer is never drawn;
 *     a fresh read stays as it is.
 */
export function snapshotAnswerOf<Data>(
  answer: ReadAnswer<Data>,
  freshness: SnapshotFreshness,
  clock: FreshnessClock,
): ReadAnswer<Data> {
  if (freshness.kind === FRESHNESS_OFFLINE) {
    return { data: answer.data, dataUpdatedAt: answer.dataUpdatedAt, isError: false, isPending: false, fetchStatus: FETCH_IDLE };
  }

  if (!clock.online) {
    return { data: undefined, dataUpdatedAt: answer.dataUpdatedAt, isError: true, isPending: false, fetchStatus: FETCH_IDLE };
  }

  if (failed(answer) || answer.data === undefined || answer.dataUpdatedAt >= clock.freshAfter) return answer;

  return { data: undefined, dataUpdatedAt: answer.dataUpdatedAt, isError: false, isPending: true, fetchStatus: FETCH_FETCHING };
}

// ------------------------------------------------------------------ the clock

/** As much of TanStack Query's `onlineManager` as the clock needs. */
export interface OnlineSource {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Whether the app is online, and the moment after which a read counts as fresh. */
export interface FreshnessClock {
  readonly online: boolean;
  readonly freshAfter: number;
  /**
   * Whether `freshAfter` is a reconnect's rather than the app's start: a
   * reconnect keeps the cached snapshot drawn until the reads are fresh.
   * Absent is the app's start.
   */
  readonly reconnected?: boolean;
}

/** The clock and its listeners. */
export interface FreshnessTracker {
  /** The current clock: the same object until it changes. */
  current(): FreshnessClock;
  /** Called after every change of the clock. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * Follows `source` from now on: a transition to online moves `freshAfter`
   * to that moment and calls `onReconnect` with it. Returns the unsubscribe.
   * Idempotent: a second call while following returns the same unsubscribe.
   */
  start(onReconnect?: (freshAfter: number) => void): () => void;
}

/**
 * The freshness clock over `source`. `freshAfter` starts at `now()` when the
 * tracker is built — the app's start — and the online state is the source's.
 */
export function freshnessTracker(source: OnlineSource, now: () => number = Date.now): FreshnessTracker {
  let clock: FreshnessClock = { online: source.isOnline(), freshAfter: now(), reconnected: false };
  const listeners = new Set<() => void>();
  let stopFollowing: (() => void) | null = null;

  return {
    current: () => clock,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    start: (onReconnect) => {
      // IDEMPOTENT: a second start follows nothing twice; it hands back the
      // same stop, and the first `onReconnect` stays the one.
      if (stopFollowing !== null) return stopFollowing;

      // Read again at the start: `main.tsx` seeds the source from
      // `navigator.onLine` after this module was first evaluated.
      if (clock.online !== source.isOnline()) clock = { ...clock, online: source.isOnline() };

      const unsubscribe = source.subscribe((online) => {
        if (online === clock.online) return;

        const reconnected = online && !clock.online;

        clock = reconnected ? { online, freshAfter: now(), reconnected: true } : { ...clock, online };

        if (reconnected) onReconnect?.(clock.freshAfter);

        for (const listener of [...listeners]) listener();
      });

      stopFollowing = () => {
        unsubscribe();
        stopFollowing = null;
      };

      return stopFollowing;
    },
  };
}
