import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  ABSENCE_TYPES_LIST_KEY,
  ABSENCE_TYPES_TABLE,
  absenceTypesNoticeOf,
  absenceTypesQueryOptions,
  absenceTypesSurfaceStateOf,
  type AbsenceTypeRow,
  type AbsenceTypesFailure,
} from '@/features/absence-types/services/list';
import {
  ABSENCE_TYPE_DRAWS_FIELD,
  ABSENCE_TYPE_STALE,
  ABSENCE_TYPE_WRITE_REFUSED,
  ABSENCE_TYPE_WRITE_UNAVAILABLE,
  absenceTypeSavedOf,
  createAbsenceType,
  enteredAbsenceTypeOf,
  refusedAbsenceTypeFieldOf,
  updateAbsenceType,
  type AbsenceTypeSaved,
  type AbsenceTypeWriteFailure,
  type AbsenceTypeWriteOutcome,
  type AbsenceTypeWriteTable,
} from '@/features/absence-types/services/write';
import { ORGANIZATION_SNAPSHOT_KEY, type OrganizationOutcome } from '@/features/organization/services/snapshot';
import {
  ORGANIZATION_SURFACE_KEYS,
  organizationNoteZoneOf,
  organizationRefusalOf,
} from '@/features/organization/services/surface-keys';
import {
  ORGANIZATION_ABSENCE_TYPES_HEADING_ID,
  ORGANIZATION_ABSENCE_TYPE_DRAWS_FIELD_ID,
  ORGANIZATION_ABSENCE_TYPE_NAME_FIELD_ID,
  ORGANIZATION_ABSENCE_TYPE_SAVE_ID,
} from '@/features/organization/utils/element-ids';
import { NO_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';
import { claimedOrganizationOf } from '@/lib/supabase/claims';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * One opening of the absence type dialog: the type it edits (`null` adds one)
 * and a fresh key, so each opening draws its form afresh from the type as it
 * is now and nothing typed outlives it.
 */
export interface AbsenceTypeOpening {
  readonly key: number;
  readonly type: AbsenceTypeRow | null;
}

/** The element whose id this is, for a focus target. */
function byId(id: string): () => HTMLElement | null {
  return () => document.getElementById(id);
}

/**
 * *Vrste odsutnosti* on *Organizacija* (story 13.1b): the organization's
 * absence types, read once, and the one dialog that adds a type or edits one.
 *
 * PART OF THE PAGE'S ONE SNAPSHOT (story 8.2d's rule): `ABSENCE_TYPES_LIST_KEY`
 * is one of `ORGANIZATION_SURFACE_KEYS`, decided here from this observer and,
 * for the row, from the cache, as `useOrganizationHourBands` decides — so the
 * card is drawn with the others or the page is unavailable as one. The page's
 * as-of note is the settings hook's; the card adds none.
 *
 * WRITES TOUCH `absence_types` ONLY, and re-read only its key: no leave
 * figure, report or member surface reads a type yet (13.2), so a landed write
 * names no dependent. Every rule is `@/features/absence-types/services/*`'s;
 * this hook holds state and wiring only.
 */
export function useOrganizationAbsenceTypes() {
  const queryClient = useQueryClient();
  /** Counts openings, so every opening gets a key of its own. */
  const openings = useRef(0);
  // A REF as well as state: state drives the busy dialog, and state is stale
  // inside a handler already called once this tick.
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [opening, setOpening] = useState<AbsenceTypeOpening | null>(null);
  const [failure, setFailure] = useState<AbsenceTypeWriteFailure | null>(null);
  /** Which kind of write landed last, so the card says so. */
  const [saved, setSaved] = useState<AbsenceTypeSaved | null>(null);

  const answerRead = useQuery(absenceTypesQueryOptions(() => supabaseClient().from(ABSENCE_TYPES_TABLE)));
  // The row exactly as the settings hook's observer holds it: the same entry,
  // so the hooks decide over one zone and one refusal.
  const row = queryClient.getQueryData<OrganizationOutcome>(ORGANIZATION_SNAPSHOT_KEY);
  const { answerOf } = useSnapshotFreshness(
    ORGANIZATION_SURFACE_KEYS,
    [[ABSENCE_TYPES_LIST_KEY, answerRead]],
    organizationNoteZoneOf(row),
  );

  // NEVER CACHED TYPES BESIDE THE PAGE'S REFUSAL (story 8.2d), as the hour
  // bands card: a row that resolved with its own refusal draws no card data.
  const refusedPage = organizationRefusalOf(row) !== null;
  const state = absenceTypesSurfaceStateOf(answerOf(answerRead));
  const types: readonly AbsenceTypeRow[] | null = refusedPage ? null : state.types;
  const refusal: AbsenceTypesFailure | null = refusedPage ? null : absenceTypesNoticeOf(state);
  const loading = !refusedPage && state.loading;

  /** Opens the dialog afresh on `type`, or on a new type: no refusal and no confirmation carried over. */
  function open(type: AbsenceTypeRow | null): void {
    if (saving.current) return;

    setFailure(null);
    setSaved(null);
    openings.current += 1;
    setOpening({ key: openings.current, type });
  }

  /** Cancel, ✕, Escape and the backdrop: never while the write is in flight. */
  function close(): void {
    if (saving.current) return;

    setOpening(null);
    setFailure(null);
  }

  /** Focus on the control a refusal is about, once the settled write re-enables it. */
  function focusRefused(code: AbsenceTypeWriteFailure): void {
    const field =
      refusedAbsenceTypeFieldOf(code) === ABSENCE_TYPE_DRAWS_FIELD
        ? ORGANIZATION_ABSENCE_TYPE_DRAWS_FIELD_ID
        : ORGANIZATION_ABSENCE_TYPE_NAME_FIELD_ID;

    focusLater([byId(field), byId(ORGANIZATION_ABSENCE_TYPE_SAVE_ID)], byId(ORGANIZATION_ABSENCE_TYPES_HEADING_ID));
  }

  /** Focus back on Spremi once the settled write re-enables it (the offline drop). */
  function focusSaveAgain(): void {
    focusLater([byId(ORGANIZATION_ABSENCE_TYPE_SAVE_ID)], byId(ORGANIZATION_ABSENCE_TYPES_HEADING_ID));
  }

  /**
   * The dialog's Spremi: the name and the drawing choice as entered. Checked
   * first, so a blank or long name and a missing choice send nothing; then an
   * insert for a new type (its tenant the session's own claim) or an update
   * of the one being edited. A refusal keeps the dialog open with what was
   * entered; a landed write closes it and says so on the card.
   */
  async function save(name: string, draws: string): Promise<void> {
    if (opening === null || saving.current) return;
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    const { type } = opening;
    const entered = enteredAbsenceTypeOf(type, name, draws);

    if (!entered.ok) {
      setFailure(entered.code);
      focusRefused(entered.code);

      return;
    }

    saving.current = true;
    setFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const client = supabaseClient();
      const table = client.from(ABSENCE_TYPES_TABLE) as unknown as AbsenceTypeWriteTable;
      let outcome: AbsenceTypeWriteOutcome;

      if (type === null) {
        const { data } = await client.auth.getSession();
        const organization = claimedOrganizationOf(data.session?.access_token);

        outcome =
          organization === null
            ? { ok: false, code: ABSENCE_TYPE_WRITE_REFUSED }
            : await createAbsenceType(table, organization, name, draws);
      } else {
        outcome = await updateAbsenceType(table, type, name, draws);
      }

      // STORY 8.3b: the connection dropped under the write — the gate's note
      // says why, not the unavailable refusal; the dialog stays open.
      if (!outcome.ok && droppedOffline(outcome.code, ABSENCE_TYPE_WRITE_UNAVAILABLE)) {
        focusSaveAgain();

        return;
      }

      if (!outcome.ok) {
        setFailure(outcome.code);
        focusRefused(outcome.code);
        // A STALE REFUSAL means the list is behind the database: its own read
        // again, and nothing else (a refusal changed no row).
        if (outcome.code === ABSENCE_TYPE_STALE) {
          void refreshAfterWrite(queryClient, ABSENCE_TYPES_LIST_KEY, NO_DEPENDENTS);
        }

        return;
      }

      // Closed, and the confirmation is on the card; the browser returns focus
      // to the button that opened the dialog.
      setOpening(null);
      setSaved(absenceTypeSavedOf(type));

      // NOT AWAITED: the write has landed, so the lock is released at once
      // (the `finally` below) and a Dodaj or Uredi pressed during the re-read
      // opens. ITS FAILURE IS NOT THE WRITE'S: a re-read that rejects is logged.
      refreshAfterWrite(queryClient, ABSENCE_TYPES_LIST_KEY, NO_DEPENDENTS).catch((cause: unknown) => {
        console.error(ABSENCE_TYPE_WRITE_UNAVAILABLE, cause);
      });
    } catch (cause) {
      console.error(ABSENCE_TYPE_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why.
      if (!writesOnline()) {
        focusSaveAgain();

        return;
      }
      setFailure(ABSENCE_TYPE_WRITE_UNAVAILABLE);
      focusRefused(ABSENCE_TYPE_WRITE_UNAVAILABLE);
    } finally {
      // On EVERY path, including the successful one.
      saving.current = false;
      setPending(false);
    }
  }

  return { types, refusal, loading, opening, pending, failure, saved, open, close, save };
}

/** What the *Vrste odsutnosti* card is drawn from. */
export type OrganizationAbsenceTypes = ReturnType<typeof useOrganizationAbsenceTypes>;
