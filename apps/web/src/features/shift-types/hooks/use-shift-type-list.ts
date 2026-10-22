import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { ROTATION_KEY, type RotationSnapshot } from '@/features/rotation/services/list';
import { ROTATION_SURFACE_KEYS, rotationSurfaceTimeZoneOf } from '@/features/rotation/services/surface-keys';
import {
  SHIFT_TYPES_LIST_KEY,
  SHIFT_TYPES_READ_TABLE,
  SHIFT_TYPES_TABLE,
  SHIFT_TYPE_VERSIONS_TABLE,
  shiftTypeListOf,
  shiftTypesQueryOptions,
  shiftTypesNoticeOf,
  shiftTypesSurfaceStateOf,
  shiftTypesSubmitTodayOf,
  shiftTypesTodayOf,
} from '@/features/shift-types/services/list';
import {
  SHIFT_TYPE_NAME_FIELD,
  SHIFT_TYPE_START_FIELD,
  SHIFT_TYPE_WORKING,
  SHIFT_TYPE_WRITE_REFUSED,
  SHIFT_TYPE_WRITE_UNAVAILABLE,
  createShiftType,
  createdOutcomeOf,
  refusedFieldOf,
  shiftTypeKindOf,
  type ShiftTypeSaved,
  type ShiftTypeVersionWriteTable,
  type ShiftTypeWriteFailure,
  type ShiftTypeWriteTable,
} from '@/features/shift-types/services/write';
import { claimedOrganizationOf } from '@/lib/supabase/claims';
import { retryRead } from '@/features/teams/services/dependents';
import { zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { supabaseClient } from '@/lib/supabase/client';
import { NO_TEXT } from '@/utils/text';

/**
 * The shift type list's state, its one read and its handlers (story 2.2b):
 * the add dialog's four uncontrolled fields, its in-flight ref and outcome,
 * and the list the table draws.
 *
 * ONE READ (AD-13) under `SHIFT_TYPES_LIST_KEY`, which carries the
 * organization's zone, so "today" — the date a new type's first times take
 * effect from — is the organization's, never the device's.
 *
 * Every rule is in `@/features/shift-types/services/list` and
 * `@/features/shift-types/services/write`, which the node suite executes; this
 * hook holds state and wiring only.
 */
export function useShiftTypeList() {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const kindField = useRef<HTMLSelectElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const endField = useRef<HTMLInputElement>(null);
  const creating = useRef(false);
  const [pending, setPending] = useState(false);
  const [working, setWorking] = useState(true);
  const [failure, setFailure] = useState<ShiftTypeWriteFailure | null>(null);
  const [saved, setSaved] = useState<ShiftTypeSaved | null>(null);
  const [adding, setAdding] = useState(false);

  // The first field, once the dialog is open. The dialog's own effect runs
  // first, so `showModal()` has already moved focus into it.
  useEffect(() => {
    if (adding) nameField.current?.focus();
  }, [adding]);

  function openAdding(): void {
    setFailure(null);
    setSaved(null);
    setAdding(true);
  }

  /**
   * Escape, the backdrop, the close control and Cancel: the dialog closes,
   * except while a create is in flight — the dialog that reports the outcome
   * cannot be closed before it lands. A landed create closes it in `submit`.
   */
  function closeAdding(): void {
    if (!creating.current) setAdding(false);
  }

  const answerRead = useQuery(
    shiftTypesQueryOptions(() => supabaseClient().from(SHIFT_TYPES_READ_TABLE)),
  );
  // STORY 8.2d: the shift types are one snapshot with the rotation builder's
  // (`ROTATION_SURFACE_KEYS`), decided here from this observer and, for the
  // builder's read, from the cache — so the page is drawn whole under one
  // note or is unavailable as one. THE ZONE is the one either snapshot
  // embeds. The page's as-of note is the builder's, under the page
  // heading; this list adds none.
  const timeZone = rotationSurfaceTimeZoneOf(
    answerRead.data,
    queryClient.getQueryData<RotationSnapshot>(ROTATION_KEY),
  );
  const { clock, answerOf } = useSnapshotFreshness(
    ROTATION_SURFACE_KEYS,
    [[SHIFT_TYPES_LIST_KEY, answerRead]],
    zoneFromReads(timeZone),
  );
  const answer = answerOf(answerRead);

  const state = shiftTypesSurfaceStateOf(answer);
  const { snapshot, loading } = state;
  // THE LIST'S NOTICE: the refusal, or the unavailable message beside rows a
  // refetch paused offline over, which is never a refusal (an edit form keeps them).
  const refusal = shiftTypesNoticeOf(state);
  // NO READ RETRY OFFLINE (story 8.2d, decision 2a): `retryable` means "show
  // the read retry now" (story 8.2e) — the read's message is up, and the
  // connection is: offline the message stays without its retry, and the
  // retry comes back with the connection.
  const retryable = clock.online && refusal !== null;
  const today = snapshot === null ? null : shiftTypesTodayOf(snapshot, new Date());
  const list = snapshot === null || today === null ? null : shiftTypeListOf(snapshot, today);

  /** The kind decides whether times are offered; a confirmation describes the last save. */
  function chooseKind(event: ChangeEvent<HTMLSelectElement>): void {
    setSaved(null);
    setWorking(shiftTypeKindOf(event.target.value) === SHIFT_TYPE_WORKING);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = nameField.current;
    const kind = kindField.current;

    if (name === null || kind === null || creating.current) return;

    creating.current = true;
    setFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const client = supabaseClient();
      const { data } = await client.auth.getSession();
      const organization = claimedOrganizationOf(data.session?.access_token);

      if (organization === null) {
        setFailure(SHIFT_TYPE_WRITE_REFUSED);

        return;
      }

      const outcome = await createShiftType(
        {
          types: client.from(SHIFT_TYPES_TABLE) as unknown as ShiftTypeWriteTable,
          versions: client.from(SHIFT_TYPE_VERSIONS_TABLE) as unknown as ShiftTypeVersionWriteTable,
        },
        organization,
        {
          name: name.value,
          kind: shiftTypeKindOf(kind.value),
          start: startField.current?.value ?? NO_TEXT,
          end: endField.current?.value ?? NO_TEXT,
        },
        // Taken again at submit, never the today this screen drew.
        shiftTypesSubmitTodayOf(snapshot),
      );

      // WHAT HAPPENS NEXT IS `createdOutcomeOf`'s, executed by the node
      // suite. A REFUSED ADD KEEPS THE ENTERED VALUES: every field is
      // uncontrolled and nothing clears them on that path (UX-DR34). A type
      // added WITHOUT its times exists, so the form is cleared and the
      // message says the times are still to be set.
      const next = createdOutcomeOf(outcome);

      setSaved(next.saved);
      setFailure(next.failure);

      if (!next.clearForm) {
        const field =
          next.failure === null ? SHIFT_TYPE_NAME_FIELD : refusedFieldOf(next.failure, SHIFT_TYPE_NAME_FIELD);

        (field === SHIFT_TYPE_START_FIELD ? startField.current : name)?.focus();
      } else {
        name.value = NO_TEXT;
        if (startField.current !== null) startField.current.value = NO_TEXT;
        if (endField.current !== null) endField.current.value = NO_TEXT;
        // Closed, and the outcome is on the page; focus returns to the
        // button that opened the dialog.
        setAdding(false);
      }

      if (!next.refetch) return;

      try {
        // The rotation builder below draws the types too, from its own
        // snapshot. Both re-reads start together, so one failing cannot skip
        // the other.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY }),
          queryClient.invalidateQueries({ queryKey: ROTATION_KEY }),
        ]);
      } catch (cause) {
        console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      setFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  /** Read the list again, from the unavailable notice's retry. */
  function retry(): void {
    void retryRead(queryClient, SHIFT_TYPES_LIST_KEY);
  }

  return {
    retry,
    retryable,
    nameField,
    kindField,
    startField,
    endField,
    pending,
    working,
    failure,
    saved,
    setSaved,
    adding,
    openAdding,
    closeAdding,
    chooseKind,
    submit,
    refusal,
    loading,
    list,
  };
}

/** What the list screen's parts are drawn from. */
export type ShiftTypeListScreen = ReturnType<typeof useShiftTypeList>;
