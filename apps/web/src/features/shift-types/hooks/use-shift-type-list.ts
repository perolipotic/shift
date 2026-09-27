import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { NO_TEXT } from '@/features/members/services/list';
import { ROTATION_KEY } from '@/features/rotation/services/list';
import {
  SHIFT_TYPES_LIST_KEY,
  SHIFT_TYPES_READ_TABLE,
  SHIFT_TYPES_TABLE,
  SHIFT_TYPE_VERSIONS_TABLE,
  shiftTypeListOf,
  shiftTypesQueryOptions,
  shiftTypesSurfaceStateOf,
  shiftTypesTodayOf,
} from '@/features/shift-types/services/list';
import {
  SHIFT_TYPE_NAME_FIELD,
  SHIFT_TYPE_START_FIELD,
  SHIFT_TYPE_WORKING,
  SHIFT_TYPE_WRITE_REFUSED,
  SHIFT_TYPE_WRITE_UNAVAILABLE,
  claimedOrganizationOf,
  createShiftType,
  createdOutcomeOf,
  refusedFieldOf,
  shiftTypeKindOf,
  type ShiftTypeSaved,
  type ShiftTypeVersionWriteTable,
  type ShiftTypeWriteFailure,
  type ShiftTypeWriteTable,
} from '@/features/shift-types/services/write';
import { supabaseClient } from '@/lib/supabase/client';

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

  const answer = useQuery(
    shiftTypesQueryOptions(() => supabaseClient().from(SHIFT_TYPES_READ_TABLE)),
  );

  const { snapshot, refusal, loading } = shiftTypesSurfaceStateOf(answer);
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
        today,
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

  return {
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
    setAdding,
    openAdding,
    chooseKind,
    submit,
    refusal,
    loading,
    list,
  };
}

/** What the list screen's parts are drawn from. */
export type ShiftTypeListScreen = ReturnType<typeof useShiftTypeList>;
