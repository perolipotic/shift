import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  checkedOf,
  type ErasureReads as CoreErasureReads,
} from '@/features/conflicts/services/erasure-check';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import { rotationCancelErasuresOutcomeOf, rotationErasuresOutcomeOf } from '@/features/rotation/services/erasures';
import { rotationScheduledDateOf, rotationTeamsOf, type RotationSnapshot } from '@/features/rotation/services/list';
import { draftRefusalOf, normalizedDraftOf, type RotationDraft } from '@/features/rotation/utils/draft';

export { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE };

/**
 * One run of the rotation save's erasure check (story 5.5a), over reads the
 * caller fetches afresh: the decision the builder acts on, as a `.ts` the
 * node suite executes. The hook (`use-erasure-check`) only fetches; the
 * never-throwing run is the shared `checkedOf` (story 5.5b).
 *
 * FOUR READS, ALL FRESH: the three core reads every erasure check stands on
 * — the calendar snapshot, the organization's live leave and its live
 * resolutions — and, the builder's own addition, the rotation the save will
 * be built from. A read that rejects — failed, or offline — answers
 * unavailable: the save is refused and nothing is written unchecked.
 *
 * THE FRESH ROTATION DECIDES FIRST. When it refuses the draft — another
 * admin saved a version on the effective date meanwhile, say — the check
 * answers `refused` with it, and the builder takes the save's own refusal
 * path, never "cannot check".
 */

/** The four reads, as their query functions answer them (each throws on a failure). */
export interface ErasureReads extends CoreErasureReads {
  readonly rotation: RotationSnapshot;
}

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
  return checkedOf(
    read,
    ({ rotation, calendar, records, resolutions }): ErasureCheck => {
      const draft = normalizedDraftOf(entered, rotationTeamsOf(rotation));

      if (draftRefusalOf(rotation, draft, today) !== null) return { kind: CHECK_REFUSED, rotation };

      const outcome = rotationErasuresOutcomeOf(calendar, rotation, draft, records, resolutions);

      return outcome.ok ? { kind: CHECK_READY, rotation, draft, rows: outcome.rows } : { kind: CHECK_UNAVAILABLE };
    },
    online,
  );
}

// ------------------------------------------------------------ the cancel (5.5g)

export type CancelErasureCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly rotation: RotationSnapshot }
  | {
      readonly kind: typeof CHECK_READY;
      /** The fresh rotation the cancel is sent from. */
      readonly rotation: RotationSnapshot;
      readonly rows: readonly ErasureRow[];
    };

/**
 * The check of cancelling the change the admin confirmed as scheduled on
 * `confirmed` (story 5.5g), on `today` (the organization's, taken once when
 * the cancel was asked), over `read`'s answer. Never throws: anything that
 * goes wrong is unavailable, and logged.
 *
 * THE FRESH ROTATION DECIDES FIRST. When it schedules nothing any more, or a
 * different date than the one confirmed, the check answers `refused` and the
 * builder takes the cancel's own STALE path, never "cannot check".
 */
export async function cancelErasureCheckOf(
  read: () => Promise<ErasureReads>,
  confirmed: string,
  today: string,
  online: boolean,
): Promise<CancelErasureCheck> {
  return checkedOf(
    read,
    ({ rotation, calendar, records, resolutions }): CancelErasureCheck => {
      if (rotationScheduledDateOf(rotation, today) !== confirmed) return { kind: CHECK_REFUSED, rotation };

      const outcome = rotationCancelErasuresOutcomeOf(calendar, rotation, confirmed, records, resolutions);

      return outcome.ok ? { kind: CHECK_READY, rotation, rows: outcome.rows } : { kind: CHECK_UNAVAILABLE };
    },
    online,
  );
}
