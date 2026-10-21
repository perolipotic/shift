import type { DragEndEvent } from '@dnd-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';

import { useErasureConfirmation } from '@/features/conflicts/hooks/use-erasure-confirmation';
import {
  rotationDraftStore,
  rotationPreviewCyclesStore,
  rotationStepperStore,
  shownDraftOf,
  unsavedDraftOf,
} from '@/features/rotation/hooks/draft-store';
import { useCancelErasureCheck, useErasureCheck } from '@/features/rotation/hooks/use-erasure-check';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/rotation/services/erasure-check';
import { scheduledChangeOf } from '@/features/rotation/services/history';
import {
  ROTATION_ASSIGNMENTS_TABLE,
  ROTATION_KEY,
  ROTATION_PATTERNS_TABLE,
  ROTATION_READ_TABLE,
  ROTATION_STEPS_TABLE,
  reopensAfterSaveOf,
  rotationQueryOptions,
  rotationScheduledDateOf,
  rotationScheduledOf,
  rotationSurfaceStateOf,
  rotationTeamsOf,
  rotationTodayOf,
  writableRotationOf,
  type RotationSnapshot,
} from '@/features/rotation/services/list';
import { savedPendingCountOf } from '@/features/rotation/services/override-disposition';
import { ROTATION_SURFACE_KEYS, rotationSurfaceTimeZoneOf } from '@/features/rotation/services/surface-keys';
import {
  ROTATION_CANCEL_STALE,
  ROTATION_WRITE_REFUSED,
  ROTATION_WRITE_UNAVAILABLE,
  cancelScheduledRotation,
  saveRotation,
  type RotationAssignmentDeleteTable,
  type RotationCancelOutcome,
  type RotationInsertTable,
  type RotationPatternTable,
} from '@/features/rotation/services/write';
import {
  FOCUS_ADD,
  draftRefusalOf,
  dropOf,
  focusAfterDropOf,
  focusAfterRemoveOf,
  normalizedDraftOf,
  stepControlIdOf,
  stepIndexOf,
  withAnchor,
  withEffectiveFrom,
  withStepMovedTo,
  withStepRemoved,
  withTeamStep,
  type RotationDraft,
  type StepControl,
  type StepFocus,
} from '@/features/rotation/utils/draft';
import { shownStepperOf } from '@/features/rotation/utils/stepper';
import {
  rotationWarningLinesOf,
  shownSaveOutcomeOf,
  type RotationWarningLine,
  type ShownSaveOutcome,
} from '@/features/rotation/utils/warnings';
import { SHIFT_TYPES_LIST_KEY, type ShiftTypesSnapshot } from '@/features/shift-types/services/list';
import {
  ROTATION_CANCEL_DEPENDENTS,
  ROTATION_SAVE_DEPENDENTS,
  refreshAfterWrite,
} from '@/features/teams/services/dependents';
import { FRESHNESS_OFFLINE, offlineNoteOf, zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { claimedOrganizationOf } from '@/lib/supabase/claims';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The rotation builder's state, its one read and every handler (stories
 * 2.3b–2.6, 3.5c, 5.5a, 5.5c, 5.5g; lifted out of `RotationSection` by the
 * epics 5–7 retro, A21 and A26, as the calendar, the member page and the
 * override review keep theirs in hooks): the draft and the stepper from
 * `@/features/rotation/hooks/draft-store`, the snapshot under `ROTATION_KEY`,
 * the save and the cancel of a scheduled change, each under the one `saving`
 * guard, and their erasure confirmations. `RotationSection` and its parts
 * render what it returns; every rule is a `.ts` module the node suite runs.
 */

/** What the erasure check stood on: the write writes exactly this. */
interface CheckedSave {
  /** The fresh rotation the check stood on. */
  readonly rotation: RotationSnapshot;
  /** The draft as checked, normalized to that rotation's active teams. */
  readonly draft: RotationDraft;
  /** The organization's today when the save was asked. */
  readonly today: string;
}

/** What the cancel's erasure check stood on: the cancel sends exactly this (story 5.5g). */
interface CheckedCancel {
  /** The fresh rotation the check stood on. */
  readonly rotation: RotationSnapshot;
  /** The scheduled date the admin confirmed. */
  readonly confirmed: string;
  /** The organization's today when the cancel was asked. */
  readonly today: string;
}

export function useRotationBuilder() {
  const queryClient = useQueryClient();
  const saving = useRef(false);
  const addField = useRef<HTMLSelectElement>(null);
  const stored = useSyncExternalStore(rotationDraftStore.subscribe, rotationDraftStore.get);
  const cycles = useSyncExternalStore(rotationPreviewCyclesStore.subscribe, rotationPreviewCyclesStore.get);
  const stepper = useSyncExternalStore(rotationStepperStore.subscribe, rotationStepperStore.get);
  const progress = useRef<HTMLParagraphElement>(null);
  const stepMoved = useRef(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ShownSaveOutcome | null>(null);
  /**
   * How many overrides the landed save left pending (story 3.5c), captured
   * once from the re-read that followed it; `null` until then, or when the
   * re-read failed or could not be derived.
   */
  const [savedPending, setSavedPending] = useState<number | null>(null);
  /** How many saves have started: the override review clears what it said last on each. */
  const [savedTimes, setSavedTimes] = useState(0);
  /**
   * The scheduled date whose cancel confirmation is open, or `null`. The
   * confirmation renders only while the snapshot still schedules that very
   * date; otherwise it is disarmed (see the effect below).
   */
  const [cancelArmed, setCancelArmed] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState<RotationCancelOutcome | null>(null);
  /** The cancel's confirmation, where focus goes when the pressed control unmounts. */
  const cancelConfirmation = useRef<HTMLParagraphElement>(null);
  const [focus, setFocus] = useState<StepFocus | null>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const checkErasures = useErasureCheck();
  /** The builder's own "Spremi rotaciju", where focus returns when the confirmation closes. */
  const saveButton = useRef<HTMLButtonElement>(null);
  /**
   * The conflicts the draft would erase and what was checked, while their
   * confirmation is open, with each row's decision (the shared freshness
   * hook, story 5.5b).
   */
  const confirmation = useErasureConfirmation<CheckedSave>(pending, () => saveButton.current);
  const erasures = confirmation.shown;
  /** The last save could not check what it would erase, so it saved nothing. */
  const [erasuresUnavailable, setErasuresUnavailable] = useState(false);
  /** How many conflicts the last landed save removed, confirmed in its dialog; 0 for none. */
  const [erasedCount, setErasedCount] = useState(0);
  /** The refusal's retry, which takes focus when the check cannot be derived. */
  const retryButton = useRef<HTMLButtonElement>(null);
  const checkCancelErasures = useCancelErasureCheck();
  /** The cancel's offer, where focus returns when its erasure dialog closes (story 5.5g). */
  const cancelOfferButton = useRef<HTMLButtonElement>(null);
  /**
   * The conflicts the cancel would erase and what was checked, while their
   * dialog is open: its OWN confirmation, separate from the save's. Closed,
   * focus returns to the cancel's offer, or to "Spremi rotaciju" once the
   * offer is gone.
   */
  const cancelErasures = useErasureConfirmation<CheckedCancel>(
    pending,
    // A LANDED CANCEL'S NOTICE first, once rendered; then the offer, then the save.
    () => cancelConfirmation.current ?? cancelOfferButton.current ?? saveButton.current,
  );
  /**
   * The scheduled date whose cancel could not check what it would erase, so
   * it deleted nothing; `null` otherwise. Its retry cancels that very date.
   */
  const [cancelUnchecked, setCancelUnchecked] = useState<string | null>(null);
  /** How many conflicts the last landed cancel removed, confirmed in its dialog; 0 for none. */
  const [cancelErasedCount, setCancelErasedCount] = useState(0);
  /** The cancel confirmation's retry, which takes focus when the check cannot be derived. */
  const cancelRetryButton = useRef<HTMLButtonElement>(null);

  // A CHECK THAT CANNOT BE DERIVED: focus on its retry, so it is announced and in reach.
  useEffect(() => {
    if (erasuresUnavailable && !pending) retryButton.current?.focus();
  }, [erasuresUnavailable, pending]);

  // THE SAME FOR THE CANCEL (story 5.5g): its retry sits inside its confirmation.
  useEffect(() => {
    if (cancelUnchecked !== null && cancelArmed !== null && !pending) cancelRetryButton.current?.focus();
  }, [cancelUnchecked, cancelArmed, pending]);

  /**
   * The checked draft's warnings (story 2.5), for the confirmation: from the
   * same rotation and normalized draft the check stood on, worked out once
   * per list shown. A throw computing them is logged and shows none; they
   * never block either way.
   */
  const erasureWarnings = useMemo((): readonly RotationWarningLine[] => {
    if (erasures === null) return [];

    try {
      return rotationWarningLinesOf(erasures.subject.rotation, erasures.subject.draft, erasures.subject.draft.effectiveFrom);
    } catch (cause) {
      console.error(ROTATION_WRITE_UNAVAILABLE, cause);

      return [];
    }
  }, [erasures]);

  // WHERE FOCUS GOES after a move or a removal is `@/features/rotation/utils/draft`'s rule;
  // here it is only applied, once the rows have re-rendered.
  useEffect(() => {
    if (focus === null) return;

    if (focus.kind === FOCUS_ADD) addField.current?.focus();
    else controls.current.get(stepControlIdOf(focus.key, focus.control))?.focus();

    setFocus(null);
  }, [focus]);

  // A STEP CHANGE MOVES FOCUS to the progress line, and scrolls it into view,
  // so a screen reader hears "Korak N od 4" and a finger starts at the top of
  // the new step. Only after a step change made here — never on a mount.
  // The store's step, named apart: `stepper` is not a ref, its `current` is the step.
  const currentStep = stepper.current;

  useEffect(() => {
    if (!stepMoved.current) return;

    stepMoved.current = false;
    progress.current?.focus({ preventScroll: true });
    progress.current?.scrollIntoView();
  }, [currentStep]);

  const answerRead = useQuery(rotationQueryOptions(() => supabaseClient().from(ROTATION_READ_TABLE)));
  // STORY 8.2d: the builder is one snapshot with the shift types beside it
  // (`ROTATION_SURFACE_KEYS`), decided here from this observer and, for the
  // shift types' read, from the cache. Online, a rotation older than this
  // session's network is never drawn as fresh; offline, the cached rotation
  // is drawn under the page's one as-of note (`offline`), or the unavailable
  // state is — a paused refetch over cached rows is never drawn unlabelled.
  // THE ZONE is the one either snapshot embeds.
  const timeZone = rotationSurfaceTimeZoneOf(
    queryClient.getQueryData<ShiftTypesSnapshot>(SHIFT_TYPES_LIST_KEY),
    answerRead.data,
  );
  const { freshness, clock, answerOf } = useSnapshotFreshness(
    ROTATION_SURFACE_KEYS,
    [[ROTATION_KEY, answerRead]],
    zoneFromReads(timeZone),
  );
  const answer = answerOf(answerRead);
  const state = rotationSurfaceStateOf(answer);
  const { snapshot, refusal } = state;
  // NO READ RETRY OFFLINE (story 8.2d, decision 2a): `retryable` means "show
  // the read retry now" (story 8.2e) — the read's message is up, and the
  // connection is: offline the message stays without its retry, and the
  // retry comes back with the connection.
  const retryable = clock.online && refusal !== null;
  // STORY 8.2d: the page's one as-of note, under its heading, while the whole
  // cached snapshot is drawn offline; none beside the unavailable message.
  const offline = offlineNoteOf(freshness, timeZone, refusal !== null);
  // NOTHING IS WRITTEN FROM THE DEVICE'S COPY (story 8.2d): while the cached
  // snapshot is drawn — offline, or just reconnected before the refetch lands
  // — a save or a cancel is refused with the existing unavailable outcome.
  const fromCache = freshness.kind === FRESHNESS_OFFLINE;
  const today = snapshot === null ? null : rotationTodayOf(snapshot, new Date());
  const draft = snapshot === null || today === null ? null : shownDraftOf(stored, snapshot, today);
  // With no draft only section 1 exists: laid out as step 1, and no stepper.
  const shown = shownStepperOf(stepper, draft !== null);

  /** Whether the admin holds unsaved changes: their own draft for this organization (story 5.5c). */
  const unsaved = snapshot !== null && unsavedDraftOf(stored, snapshot.organizationId);

  /** What an edit, or a discard, clears: a message describes the last save only. */
  function clearRaised(): void {
    setOutcome(null);
    setSavedPending(null);
    setErasedCount(0);
    setCancelled(null);
    setErasuresUnavailable(false);
  }

  /** Every change goes through a draft operation, into the store. */
  function change(next: RotationDraft): void {
    // NOTHING CHANGES THE DRAFT while a check or a write is in flight: the
    // controls are disabled then, and this holds even if one is not.
    if (saving.current) return;

    clearRaised();
    if (snapshot !== null) rotationDraftStore.set(snapshot.organizationId, next);
  }

  /**
   * "Odbaci promjene" (story 5.5c): forgets the local draft, so the builder
   * shows the prefill again, and clears what an edit clears, the cancel's
   * own refusal included. No confirmation — nothing saved is touched. The
   * cancel offer and the override review stay as they are. The phone
   * stepper goes back to step 1, so it never stands on a step reached with
   * the discarded pattern (the preview's cycles are a view choice and stay).
   * Focus goes to "Spremi rotaciju", which stays mounted while the discard
   * itself unmounts.
   */
  function discard(): void {
    if (saving.current) return;

    clearRaised();
    setCancelUnchecked(null);
    rotationDraftStore.reset();
    rotationStepperStore.reset();
    saveButton.current?.focus();
  }

  /**
   * Registers one step control, so focus can be put back on it by key. A
   * removed step's entry is simply left: its key is never reused, so nothing
   * ever asks for it again.
   */
  function registerControl(key: string, control: StepControl) {
    return (element: HTMLButtonElement | null): void => {
      if (element !== null) controls.current.set(stepControlIdOf(key, control), element);
    };
  }

  /** A drop: the move is `withStepMovedTo`'s, focus lands where `focusAfterDropOf` says. */
  function drop(current: RotationDraft, event: DragEndEvent): void {
    const moved = dropOf(current, String(event.active.id), event.over === null ? null : String(event.over.id));

    if (moved === null) return;

    const next = withStepMovedTo(current, moved.from, moved.to);

    change(next);
    setFocus(focusAfterDropOf(next, moved.to));
  }

  function remove(current: RotationDraft, index: number): void {
    const next = withStepRemoved(current, index);

    change(next);
    setFocus(focusAfterRemoveOf(next, index));
  }

  /**
   * THE WRITE ITSELF, under a guard its caller already holds: `saveRotation`
   * on `today` — the organization's today when the save was asked, so the
   * refusal checked then is the one the write applies — from `writable`, the
   * rotation the check (if any) stood on, and `current`, the draft it checked.
   * `erased` is how many conflicts the admin confirmed it removes.
   */
  async function write(writable: RotationSnapshot, current: RotationDraft, today: string, erased: number): Promise<void> {
    setSavedTimes((count) => count + 1);

    const client = supabaseClient();
    const { data } = await client.auth.getSession();
    const organization = claimedOrganizationOf(data.session?.access_token);

    if (organization === null) {
      setOutcome({ ok: false, code: ROTATION_WRITE_REFUSED, afterPattern: false });

      return;
    }

    const saved = await saveRotation(
      {
        patterns: client.from(ROTATION_PATTERNS_TABLE) as unknown as RotationPatternTable,
        steps: client.from(ROTATION_STEPS_TABLE) as unknown as RotationPatternTable,
        assignments: client.from(ROTATION_ASSIGNMENTS_TABLE) as unknown as RotationInsertTable,
      },
      organization,
      writable,
      current,
      today,
    );

    // A REFUSED SAVE KEEPS THE DRAFT: nothing below touches it on that path.
    // A LANDED ONE CARRIES ITS WARNINGS (story 2.5), from the draft just
    // saved and the date its versions apply from (story 2.6) — before the
    // draft re-opens below. They never block: the rows are already written.
    setOutcome(shownSaveOutcomeOf(saved, writable, current, current.effectiveFrom));

    if (!saved.ok) return;

    setErasedCount(erased);

    // THE SCHEDULE CHANGED (story 5.5a): beside the builder's own read, the
    // calendar snapshot and the two reads the queue derives with it, so an
    // erased conflict leaves the queue on the next read.
    try {
      await refreshAfterWrite(queryClient, ROTATION_KEY, ROTATION_SAVE_DEPENDENTS);
    } catch (cause) {
      console.error(ROTATION_WRITE_UNAVAILABLE, cause);
    }

    // The draft re-opens as what is now in force — but only from a fresh
    // read; over a failed one it stays as it was saved. The count of
    // overrides left pending is taken from that same fresh read, once.
    if (reopensAfterSaveOf(queryClient.getQueryState(ROTATION_KEY)?.status)) {
      rotationDraftStore.reset();

      const reread = queryClient.getQueryData<RotationSnapshot>(ROTATION_KEY);

      if (reread !== undefined) setSavedPending(savedPendingCountOf(reread));
    }
  }

  /**
   * "Spremi rotaciju" and the refusal's "Pokušaj ponovno" (story 5.5a): the
   * erasure check, then the write, under ONE guard held from the press to the
   * write's end — the builder's inputs stay disabled and nothing else starts
   * in between.
   *
   * TODAY IS TAKEN ONCE, at the press: a tab left open past the
   * organization's midnight runs the refusal, the check and the write on the
   * day the save is actually made. A draft the save refuses anyway goes
   * straight to the write, which refuses it as it always did; so does one the
   * check's fresh rotation refuses. Otherwise the check: none erased writes at
   * once, some open their confirmation, and a check that cannot be derived
   * refuses the save with a retry. Nothing is saved unchecked.
   */
  async function requestSave(): Promise<void> {
    const writable = writableRotationOf(state, fromCache);

    if (draft === null || saving.current) return;

    saving.current = true;
    setOutcome(null);
    setSavedPending(null);
    setErasedCount(0);
    setCancelled(null);
    setErasuresUnavailable(false);
    setPending(true);

    try {
      if (writable === null) {
        setOutcome({ ok: false, code: ROTATION_WRITE_UNAVAILABLE, afterPattern: false });

        return;
      }

      const today = rotationTodayOf(writable, new Date());

      if (draftRefusalOf(writable, normalizedDraftOf(draft, rotationTeamsOf(writable)), today) !== null) {
        await write(writable, draft, today, 0);

        return;
      }

      const check = await checkErasures(draft, today);

      if (check.kind === CHECK_UNAVAILABLE) {
        setErasuresUnavailable(true);

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        await write(check.rotation, draft, today, 0);

        return;
      }

      if (check.rows.length === 0) {
        await write(check.rotation, check.draft, today, 0);

        return;
      }

      confirmation.show(check.rows, { rotation: check.rotation, draft: check.draft, today });
    } catch (cause) {
      console.error(ROTATION_WRITE_UNAVAILABLE, cause);
      setOutcome({ ok: false, code: ROTATION_WRITE_UNAVAILABLE, afterPattern: false });
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  /**
   * The confirmation's own save, once every row is confirmed, under the same
   * one guard: the check is derived again from fresh reads for the very draft
   * and day it was shown for. The same conflicts, as shown: the dialog closes
   * and the write runs. A changed list: it is shown again, undecided, with a
   * line saying so. A check that cannot be derived closes the dialog and
   * refuses the save; a draft the fresh rotation refuses takes the save's own
   * refusal.
   */
  async function confirmErasures(shown: NonNullable<typeof erasures>): Promise<void> {
    if (saving.current || !confirmation.confirmed) return;

    const { draft: checked, today: savedToday } = shown.subject;

    saving.current = true;
    setPending(true);

    try {
      const check = await checkErasures(checked, savedToday);

      await confirmation.follow(shown, check, {
        unavailable: () => {
          confirmation.drop();
          setErasuresUnavailable(true);
        },
        refused: async ({ rotation }) => {
          confirmation.close();
          await write(rotation, checked, savedToday, 0);
        },
        subjectOf: ({ rotation, draft: fresh }) => ({ rotation, draft: fresh, today: savedToday }),
        write: async ({ rows }, fresh) => {
          confirmation.close();
          await write(fresh.rotation, fresh.draft, savedToday, rows.length);
        },
      });
    } catch (cause) {
      console.error(ROTATION_WRITE_UNAVAILABLE, cause);
      confirmation.drop();
      setOutcome({ ok: false, code: ROTATION_WRITE_UNAVAILABLE, afterPattern: false });
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  /**
   * What a cancel's outcome leaves on screen (stories 2.6, 5.5g): the notice,
   * and the re-read. A landed cancel re-reads `ROTATION_KEY` and its
   * dependents — the calendar, the leave and the resolutions — so the
   * calendar and the queue show the revert; a stale one re-reads only
   * `ROTATION_KEY`. The draft is kept either way.
   */
  async function settleCancel(outcome: RotationCancelOutcome, erased: number): Promise<void> {
    const stale = !outcome.ok && outcome.code === ROTATION_CANCEL_STALE;

    // The scheduled refusal it was offered beside no longer holds — landed,
    // or stale and about to be re-read; a save after the re-read refuses
    // again if a change is still scheduled.
    if (outcome.ok || stale) {
      setOutcome(null);
      setSavedPending(null);
    }
    setCancelled(outcome);
    if (outcome.ok) setCancelErasedCount(erased);

    try {
      if (outcome.ok) await refreshAfterWrite(queryClient, ROTATION_KEY, ROTATION_CANCEL_DEPENDENTS);
      else if (stale) await queryClient.invalidateQueries({ queryKey: ROTATION_KEY });
    } catch (cause) {
      console.error(ROTATION_WRITE_UNAVAILABLE, cause);
    }

    // The offer unmounts with the refusal; focus follows the confirmation
    // rather than falling to the document, as the shift type cancel's does.
    // (From the erasure dialog, its close puts it there once it is gone.)
    if (outcome.ok) cancelConfirmation.current?.focus();
  }

  /**
   * THE CANCEL ITSELF, under a guard its caller already holds (story 2.6,
   * decision 2a): `cancelScheduledRotation` on `today` — the organization's
   * today, taken at the press and taken again before the dialog's save — from
   * `writable`, the rotation the check (if any) stood on, for the date the
   * admin `confirmed`. `erased` is how many conflicts the admin confirmed it
   * removes.
   */
  async function writeCancel(
    writable: RotationSnapshot,
    today: string,
    confirmed: string,
    erased: number,
  ): Promise<RotationCancelOutcome> {
    const client = supabaseClient();
    const { data } = await client.auth.getSession();
    const organization = claimedOrganizationOf(data.session?.access_token);

    if (organization === null) {
      const refused: RotationCancelOutcome = { ok: false, code: ROTATION_WRITE_REFUSED };

      setCancelled(refused);

      return refused;
    }

    const outcome = await cancelScheduledRotation(
      client.from(ROTATION_ASSIGNMENTS_TABLE) as unknown as RotationAssignmentDeleteTable,
      organization,
      writable,
      today,
      confirmed,
    );

    await settleCancel(outcome, erased);

    return outcome;
  }

  /**
   * The cancel confirmation's own confirm and its retry (stories 2.6, 5.5g):
   * the erasure check, then the cancel, under ONE guard held from the press
   * to the write's end. The confirmation stays mounted and disabled while
   * either is outstanding — a refusal shown in it, with its retry, included.
   *
   * TODAY IS TAKEN ONCE, at the press. A cancel the snapshot, or the check's
   * fresh rotation, already finds stale — nothing scheduled any more, or
   * another date than the one confirmed — goes straight to the write, which
   * refuses it as STALE as it always did. Otherwise the check: none erased
   * cancels at once; some close the confirmation and open the cancel's own
   * erasure dialog; a check that cannot be derived keeps the confirmation
   * open with its refusal and a retry. Nothing is deleted unchecked.
   */
  async function cancelScheduled(confirmed: string): Promise<void> {
    const writable = writableRotationOf(state, fromCache);

    if (saving.current) return;

    // Disarmed when this settles, except while it asks for a retry; the
    // refusal stays mounted until then, so focus stays in the confirmation.
    let unchecked = false;

    saving.current = true;
    setCancelled(null);
    setCancelErasedCount(0);
    setPending(true);

    try {
      if (writable === null) {
        setCancelled({ ok: false, code: ROTATION_WRITE_UNAVAILABLE });

        return;
      }

      const today = rotationTodayOf(writable, new Date());

      if (rotationScheduledDateOf(writable, today) !== confirmed) {
        await writeCancel(writable, today, confirmed, 0);

        return;
      }

      const check = await checkCancelErasures(confirmed, today);

      if (check.kind === CHECK_UNAVAILABLE) {
        unchecked = true;

        return;
      }

      if (check.kind === CHECK_REFUSED || check.rows.length === 0) {
        await writeCancel(check.rotation, today, confirmed, 0);

        return;
      }

      cancelErasures.show(check.rows, { rotation: check.rotation, confirmed, today });
    } catch (cause) {
      console.error(ROTATION_WRITE_UNAVAILABLE, cause);
      setCancelled({ ok: false, code: ROTATION_WRITE_UNAVAILABLE });
    } finally {
      saving.current = false;
      setPending(false);
      setCancelUnchecked(unchecked ? confirmed : null);
      if (!unchecked) setCancelArmed(null);
    }
  }

  /**
   * The cancel's erasure dialog's own save, once every row is confirmed (story
   * 5.5g), under the same one guard. The dialog stays open, busy, until the
   * write settles, and closes after it; focus then goes to the landed
   * cancel's notice, or back to the offer, or to the save.
   *
   * TODAY IS TAKEN AGAIN: the organization's day the dialog was shown for has
   * passed — before the re-check, or during it — so the cancel is STALE,
   * and nothing is deleted with yesterday's today. Otherwise the check is
   * derived again from fresh reads on that day. The same conflicts, as
   * shown: the cancel runs, from the check's rotation. A changed list: it is
   * shown again, undecided. A fresh rotation that no longer schedules the
   * confirmed date takes the cancel's own STALE path. A check that cannot be
   * derived closes the dialog and arms the cancel's confirmation again, with
   * its refusal and retry — or, once nothing is scheduled to confirm, puts
   * focus on the save.
   */
  async function confirmCancelErasures(shown: NonNullable<typeof cancelErasures.shown>): Promise<void> {
    if (saving.current || !cancelErasures.confirmed) return;

    const { confirmed, today: shownToday, rotation: shownRotation } = shown.subject;
    const rolledOver = (rotation: RotationSnapshot): boolean => rotationTodayOf(rotation, new Date()) !== shownToday;

    saving.current = true;
    setPending(true);

    try {
      if (rolledOver(shownRotation)) {
        await settleCancel({ ok: false, code: ROTATION_CANCEL_STALE }, 0);
        cancelErasures.close();

        return;
      }

      const check = await checkCancelErasures(confirmed, shownToday);
      // The fresh rotation's own refusal, or a day gone by: STALE, nothing deleted.
      const stale = async (): Promise<void> => {
        await settleCancel({ ok: false, code: ROTATION_CANCEL_STALE }, 0);
        cancelErasures.close();
      };

      await cancelErasures.follow(shown, check, {
        stopped: async (answered) => {
          if (answered.kind !== CHECK_READY || !rolledOver(answered.rotation)) return false;

          await stale();

          return true;
        },
        unavailable: () => {
          cancelErasures.drop();
          setCancelUnchecked(confirmed);
          setCancelArmed(confirmed);
        },
        refused: stale,
        subjectOf: ({ rotation }) => ({ rotation, confirmed, today: shownToday }),
        write: async ({ rows }, fresh) => {
          await writeCancel(fresh.rotation, shownToday, confirmed, rows.length);
          cancelErasures.close();
        },
      });
    } catch (cause) {
      console.error(ROTATION_WRITE_UNAVAILABLE, cause);
      setCancelled({ ok: false, code: ROTATION_WRITE_UNAVAILABLE });
      cancelErasures.close();
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  /** A team's step `<select>`: the value is read as a step of the draft, or ignored. */
  function chooseTeamStep(current: RotationDraft, teamId: string) {
    return (event: ChangeEvent<HTMLSelectElement>): void => {
      const index = stepIndexOf(current, event.target.value);

      if (index !== null) change(withTeamStep(current, teamId, index));
    };
  }

  /** The preview's cycles: validated by the store to one of the choices. */
  function chooseCycles(event: ChangeEvent<HTMLSelectElement>): void {
    rotationPreviewCyclesStore.set(event.target.value);
  }

  /** The shared anchor: only a calendar date moves it. */
  function chooseAnchor(current: RotationDraft) {
    return (event: ChangeEvent<HTMLInputElement>): void => {
      change(withAnchor(current, event.target.value));
    };
  }

  /** `Vrijedi od`: only a calendar date moves it; one before today is refused at the save. */
  function chooseEffectiveFrom(current: RotationDraft) {
    return (event: ChangeEvent<HTMLInputElement>): void => {
      change(withEffectiveFrom(current, event.target.value));
    };
  }

  /**
   * Every step change goes through the stepper store, and then moves focus —
   * only when the store actually changed. A tap on the current step (still
   * enabled, `aria-current`) is a no-op the store ignores, and must not leave
   * a flag behind for a later, unrelated change to steal focus with.
   */
  function moveStep(move: () => void): void {
    const before = rotationStepperStore.get();

    // Raised BEFORE the move, in case the store's render commits inside it,
    // and lowered again when nothing moved.
    stepMoved.current = true;
    move();
    if (rotationStepperStore.get() === before) stepMoved.current = false;
  }

  // The change still scheduled in the snapshot, which the cancel is offered for.
  const scheduled =
    snapshot === null || today === null || !rotationScheduledOf(snapshot, today)
      ? null
      : scheduledChangeOf(snapshot, today);
  /** The cancel's confirmation, while the snapshot still schedules the very date it was armed for. */
  const cancelShown = cancelArmed !== null && scheduled !== null && scheduled.effectiveFrom === cancelArmed;

  // NEVER ARMED WITH NO CONFIRMATION RENDERED (story 5.5g): once the date it
  // was armed for is no longer scheduled — cancelled elsewhere, in effect, or
  // a day gone by — it is disarmed, and focus goes to the save.
  useEffect(() => {
    if (cancelArmed === null || cancelShown || pending) return;

    setCancelArmed(null);
    setCancelUnchecked(null);
    saveButton.current?.focus();
  }, [cancelArmed, cancelShown, pending]);

  return {
    state,
    snapshot,
    refusal,
    offline,
    retryable,
    today,
    draft,
    shown,
    stepper,
    cycles,
    pending,
    unsaved,
    outcome,
    scheduled,
    cancelShown,
    cancelled,
    cancelErasedCount,
    erasedCount,
    savedPending,
    savedTimes,
    erasuresUnavailable,
    erasures,
    erasureWarnings,
    confirmation,
    cancelErasures,
    cancelUnchecked,
    setCancelUnchecked,
    setCancelArmed,
    addField,
    progress,
    saveButton,
    retryButton,
    cancelOfferButton,
    cancelRetryButton,
    cancelConfirmation,
    change,
    discard,
    registerControl,
    drop,
    remove,
    requestSave,
    confirmErasures,
    cancelScheduled,
    confirmCancelErasures,
    chooseTeamStep,
    chooseCycles,
    chooseAnchor,
    chooseEffectiveFrom,
    moveStep,
  };
}

/** Everything the builder's parts read, as the hook returns it. */
export type RotationBuilder = ReturnType<typeof useRotationBuilder>;
