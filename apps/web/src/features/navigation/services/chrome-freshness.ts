import { FETCH_FETCHING, FETCH_IDLE, failed, type FreshnessClock, type ReadAnswer } from '@/lib/offline/freshness';

/** How one chrome read is treated when nothing of it is cached offline. */
export interface ChromeReadOptions {
  /**
   * Whether the chrome cannot stand without this read — the role, which the
   * navigation is built from. Offline with nothing cached, a required read is
   * FAILED, so the chrome shows its role-unavailable notice and retry rather
   * than an endless navigation skeleton. Any other read (the name, the
   * organization) is settled with nothing, and falls back as it always has.
   */
  readonly required?: boolean;
}

/** The answer shown as failed with no data: the chrome's existing unavailable path. */
function failedAnswerOf<Data>(answer: ReadAnswer<Data>): ReadAnswer<Data> {
  return { data: undefined, dataUpdatedAt: answer.dataUpdatedAt, isError: true, isPending: false, fetchStatus: FETCH_IDLE };
}

/** The answer settled, with `data` (none for a fallback): no error, no fetch, nothing pending. */
function settledAnswerOf<Data>(answer: ReadAnswer<Data>, data: Data | undefined): ReadAnswer<Data> {
  return { data, dataUpdatedAt: answer.dataUpdatedAt, isError: false, isPending: false, fetchStatus: FETCH_IDLE };
}

/**
 * ONE CHROME READ AS THE CHROME MAY DRAW IT (story 8.2b, human decision
 * 2026-10-20, 2a): the role, the member's name and the organization each
 * decide their freshness ALONE, so one missing read never takes another down
 * — a name never read leaves the role and the navigation standing.
 *
 *   - OFFLINE, a cached value is drawn, settled (its data, no error, no
 *     fetch), so a paused refetch over it neither pulses nor refuses. With
 *     nothing cached, a `required` read (the role) is failed, so its notice
 *     and retry show; any other is settled with nothing — the name and the
 *     organization's lockup fall back, never pulse for good.
 *   - ONLINE AFTER THE APP'S START, a value older than `freshAfter` — restored
 *     from the device — is never drawn: pending while it is read again, as on
 *     a cold start (the navigation waits for the role); failed with no data
 *     when that read FAILED or none is in flight, so the role's notice and
 *     retry show, no navigation is built from a restored role, and the name
 *     and organization fall back. A failed read with nothing restored under
 *     it, or a fresh value under a failed refetch, passes as it is.
 *   - ONLINE AFTER A RECONNECT, and every other answer, is left as it is: a
 *     name drawn a moment ago stays while it is read again, as between online
 *     navigations.
 *
 * The chrome states no as-of time of its own: the surface under it does.
 */
export function chromeAnswerOf<Data>(
  answer: ReadAnswer<Data>,
  clock: FreshnessClock,
  options: ChromeReadOptions = {},
): ReadAnswer<Data> {
  if (!clock.online) {
    if (answer.data !== undefined) return settledAnswerOf(answer, answer.data);

    return options.required === true ? failedAnswerOf(answer) : settledAnswerOf(answer, undefined);
  }

  const restored = clock.reconnected !== true && answer.data !== undefined && answer.dataUpdatedAt < clock.freshAfter;

  if (!restored) return answer;

  // A restored value: never drawn. Pending while it is read again; failed when that read failed or none is coming.
  return answer.fetchStatus === FETCH_FETCHING && !failed(answer)
    ? { data: undefined, dataUpdatedAt: answer.dataUpdatedAt, isError: false, isPending: true, fetchStatus: FETCH_FETCHING }
    : failedAnswerOf(answer);
}
