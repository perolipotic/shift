import {
  normalizedDraftOf,
  prefillOf,
  previewCyclesOf,
  type PreviewCycles,
  type RotationDraft,
} from '@/rotation/draft';
import { rotationTeamsOf, type RotationSnapshot } from '@/rotation/list';
import {
  STEPPER_START,
  stepperBack,
  stepperNext,
  stepperOpen,
  stepperStepOf,
  type StepperState,
} from '@/rotation/stepper';

/**
 * Where the builder's UNSAVED draft lives: outside the component (story 2.3b,
 * as renegotiated). `/postavke-rotacije/tipovi-smjena/$id` renders the screen
 * behind its dialog from another route, which remounts the builder; a draft in
 * component state would be lost every time a shift type is opened.
 *
 * A small module-level store, not the query cache: the draft is the admin's
 * own edit and is never fetched, and a second query key would put a second
 * read's rules around something that is not a read. It renders nothing and
 * knows nothing of React — the section subscribes to it with
 * `useSyncExternalStore`.
 *
 * THE DRAFT IS HELD PER ORGANIZATION. A draft kept from one organization is
 * never shown for another (a sign-in to a different tenant in the same tab),
 * and what is shown is always re-normalized against the snapshot of the
 * moment: a team added since joins on step 1, an archived one drops out, and a
 * type archived since is labelled by the draft's own display rows.
 */

/** A draft as it was last edited, and the organization it belongs to. */
export interface StoredDraft {
  readonly organizationId: string;
  readonly draft: RotationDraft;
}

export interface DraftStore {
  /** The stored draft, or `null` when the builder shows the prefill. */
  get(): StoredDraft | null;
  /** Keep an edit. */
  set(organizationId: string, draft: RotationDraft): void;
  /** Forget the edit — after a landed save — so the builder re-opens as the rotation in force. */
  reset(): void;
  /** `useSyncExternalStore`'s subscription: the listener runs after every change. */
  subscribe(listener: () => void): () => void;
}

export function createDraftStore(): DraftStore {
  let stored: StoredDraft | null = null;
  // An array rather than a Set, so no delete call appears in `@/rotation` —
  // the sweep that keeps a delete of a pattern, step or assignment out of it.
  let listeners: readonly (() => void)[] = [];
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    get: () => stored,
    set(organizationId, draft) {
      stored = { organizationId, draft };
      notify();
    },
    reset() {
      if (stored === null) return;
      stored = null;
      notify();
    },
    subscribe(listener) {
      listeners = [...listeners, listener];

      return () => {
        listeners = listeners.filter((kept) => kept !== listener);
      };
    },
  };
}

/**
 * How many cycles the preview shows: VIEW STATE, kept beside the draft for the
 * same reason (the dialog's remount), and never saved or compared. Every value
 * set is validated to one of the choices.
 */
export interface PreviewCyclesStore {
  get(): PreviewCycles;
  set(value: number | string): void;
  subscribe(listener: () => void): () => void;
}

export function createPreviewCyclesStore(): PreviewCyclesStore {
  let cycles: PreviewCycles = 1;
  let listeners: readonly (() => void)[] = [];

  return {
    get: () => cycles,
    set(value) {
      const next = previewCyclesOf(value);

      if (next === cycles) return;
      cycles = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners = [...listeners, listener];

      return () => {
        listeners = listeners.filter((kept) => kept !== listener);
      };
    },
  };
}

/**
 * Where the phone stepper stands (story 2.4): VIEW STATE, kept beside the
 * draft for the same reason (the shift type dialog's remount), and never
 * saved. Every change goes through `@/rotation/stepper`'s rules; a value set
 * that is not a step, or a step not yet reached, leaves the state as it was.
 * Subscribers hear only of a change.
 */
export interface StepperStore {
  get(): StepperState;
  /** A tap in the bar: go to a reached step; anything else is ignored. */
  set(value: number | string): void;
  /** Dalje. */
  next(): void;
  /** Natrag. */
  back(): void;
  subscribe(listener: () => void): () => void;
}

export function createStepperStore(): StepperStore {
  let state: StepperState = STEPPER_START;
  let listeners: readonly (() => void)[] = [];
  const settle = (next: StepperState) => {
    if (next.current === state.current && next.reached === state.reached) return;
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    get: () => state,
    set(value) {
      const step = stepperStepOf(value);

      if (step !== null) settle(stepperOpen(state, step));
    },
    next() {
      settle(stepperNext(state));
    },
    back() {
      settle(stepperBack(state));
    },
    subscribe(listener) {
      listeners = [...listeners, listener];

      return () => {
        listeners = listeners.filter((kept) => kept !== listener);
      };
    },
  };
}

/** The one stepper the builder uses, for the life of the tab. */
export const rotationStepperStore = createStepperStore();

/** The one cycles choice the builder uses, for the life of the tab. */
export const rotationPreviewCyclesStore = createPreviewCyclesStore();

/** The one store the builder uses, for the life of the tab. */
export const rotationDraftStore = createDraftStore();

/**
 * The draft the builder shows: the stored edit when it belongs to this
 * snapshot's organization, otherwise the prefill of the rotation in force
 * today — either way normalized against the snapshot's active teams.
 */
export function shownDraftOf(
  stored: StoredDraft | null,
  snapshot: RotationSnapshot,
  today: string,
): RotationDraft {
  const own = stored !== null && stored.organizationId === snapshot.organizationId ? stored.draft : null;

  return normalizedDraftOf(own ?? prefillOf(snapshot, today), rotationTeamsOf(snapshot));
}
