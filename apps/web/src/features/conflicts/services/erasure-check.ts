import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { ERASURES_UNAVAILABLE } from '@/features/conflicts/services/erasures';

/**
 * One run of an erasure check (stories 5.5a, 5.5b), over reads the caller
 * fetches afresh: the decision a surface acts on, as a `.ts` the node suite
 * executes. The hook (`use-erasure-reads`) only fetches.
 *
 * THREE CORE READS, ALL FRESH: the calendar snapshot, the organization's live
 * leave and its live resolutions, which the diff stands on. A surface may add
 * reads of its own (the rotation builder adds the rotation it saves from). A
 * read that rejects — failed, or offline — answers unavailable: the change is
 * refused and nothing is written unchecked.
 */

/** The three core reads, as their query functions answer them (each throws on a failure). */
export interface ErasureReads {
  readonly calendar: CalendarSnapshot;
  readonly records: readonly unknown[];
  readonly resolutions: readonly unknown[];
}

/** The check could not be derived: the change is refused, with a retry. */
export const CHECK_UNAVAILABLE = ERASURES_UNAVAILABLE;
/** The change is refused anyway, before any erasure: the surface's own refusal is shown. */
export const CHECK_REFUSED = 'refused';
/** Derived: the erasures, none included, and what the write will send. */
export const CHECK_READY = 'ready';

/** What every check answers when it cannot be derived. */
export interface UnavailableCheck {
  readonly kind: typeof CHECK_UNAVAILABLE;
}

/**
 * `decide` over `read`'s answer, NEVER THROWING: offline, a rejected read, or
 * anything `decide` throws answers unavailable, and is logged.
 */
export async function checkedOf<Reads, Check>(
  read: () => Promise<Reads>,
  decide: (reads: Reads) => Check,
  online: boolean,
): Promise<Check | UnavailableCheck> {
  // A fetch paused offline would wait for the network rather than fail.
  if (!online) return { kind: CHECK_UNAVAILABLE };

  try {
    return decide(await read());
  } catch (cause) {
    console.error(CHECK_UNAVAILABLE, cause);

    return { kind: CHECK_UNAVAILABLE };
  }
}
