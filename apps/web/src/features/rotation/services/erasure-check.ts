import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  ERASURES_UNAVAILABLE,
  rotationErasuresOutcomeOf,
  type ErasureRow,
} from '@/features/rotation/services/erasures';
import { rotationTeamsOf, type RotationSnapshot } from '@/features/rotation/services/list';
import { draftRefusalOf, normalizedDraftOf, type RotationDraft } from '@/features/rotation/utils/draft';

/**
 * One run of the rotation save's erasure check (story 5.5a), over reads the
 * caller fetches afresh: the decision the builder acts on, as a `.ts` the
 * node suite executes. The hook (`use-erasure-check`) only fetches.
 *
 * FOUR READS, ALL FRESH: the rotation the save will be built from, and the
 * calendar snapshot, the organization's live leave and its live resolutions
 * the diff stands on. A read that rejects — failed, or offline — answers
 * unavailable: the save is refused and nothing is written unchecked.
 *
 * THE FRESH ROTATION DECIDES FIRST. When it refuses the draft — another
 * admin saved a version on the effective date meanwhile, say — the check
 * answers `refused` with it, and the builder takes the save's own refusal
 * path, never "cannot check".
 */

/** The four reads, as their query functions answer them (each throws on a failure). */
export interface ErasureReads {
  readonly rotation: RotationSnapshot;
  readonly calendar: CalendarSnapshot;
  readonly records: readonly unknown[];
  readonly resolutions: readonly unknown[];
}

/** The check could not be derived: the save is refused, with a retry. */
export const CHECK_UNAVAILABLE = ERASURES_UNAVAILABLE;
/** The fresh rotation refuses the draft: the save's own refusal is shown. */
export const CHECK_REFUSED = 'refused';
/** Derived: the erasures, none included, and what the save will write. */
export const CHECK_READY = 'ready';

export type ErasureCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly rotation: RotationSnapshot }
  | {
      readonly kind: typeof CHECK_READY;
      /** The fresh rotation the save is built from. */
      readonly rotation: RotationSnapshot;
      /** The draft as the save sends it, normalized to that rotation's active teams: the one checked. */
      readonly draft: RotationDraft;
      readonly rows: readonly ErasureRow[];
    };

/**
 * The check of saving `entered` on `today` (the organization's, taken once
 * when the save was asked), over `read`'s answer. Never throws: anything that
 * goes wrong is unavailable, and logged.
 */
export async function erasureCheckOf(
  read: () => Promise<ErasureReads>,
  entered: RotationDraft,
  today: string,
  online: boolean,
): Promise<ErasureCheck> {
  // A fetch paused offline would wait for the network rather than fail.
  if (!online) return { kind: CHECK_UNAVAILABLE };

  try {
    const { rotation, calendar, records, resolutions } = await read();
    const draft = normalizedDraftOf(entered, rotationTeamsOf(rotation));

    if (draftRefusalOf(rotation, draft, today) !== null) return { kind: CHECK_REFUSED, rotation };

    const outcome = rotationErasuresOutcomeOf(calendar, rotation, draft, records, resolutions);

    return outcome.ok ? { kind: CHECK_READY, rotation, draft, rows: outcome.rows } : { kind: CHECK_UNAVAILABLE };
  } catch (cause) {
    console.error(CHECK_UNAVAILABLE, cause);

    return { kind: CHECK_UNAVAILABLE };
  }
}
