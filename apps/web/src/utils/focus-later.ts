/**
 * Focus after a write settles, as a pure module (AD-15).
 *
 * A write's handler sets its state and then asks for focus on an element the
 * NEXT render draws: the removal that replaces a form, the notice that reports
 * a result. One animation frame is not enough for that. TanStack Query tells
 * its observers about refetched data on a `setTimeout(0)` batch, so on a slow
 * machine the frame can run before the component has re-rendered, the target
 * is not in the document yet, and focus fell to the fallback.
 *
 * So the wait is frame by frame: on each frame the first target that is in the
 * document and not disabled takes focus. When none is ready after
 * {@link FOCUS_FRAMES} frames, the fallback takes it, so focus never falls to
 * the page body. The frame scheduler is injectable so a test can step it.
 */

/** Frames to wait for a target before the fallback takes focus: about half a second at 60 Hz. */
export const FOCUS_FRAMES = 30;

/** What focus needs of an element. */
export interface Focusable {
  readonly isConnected: boolean;
  readonly disabled?: boolean;
  /**
   * The DOM's selector test, where the element has one: `:disabled` also
   * holds for a control inside a disabled `<fieldset>`, whose own `disabled`
   * stays false while `focus()` on it does nothing.
   */
  matches?(selector: string): boolean;
  /**
   * The element's document, where it has one: whether `focus()` took is its
   * `activeElement` (or an element inside it, for delegated focus), and
   * `body` is where focus rests when nobody holds it.
   */
  readonly ownerDocument?: { readonly activeElement: unknown; readonly body?: unknown } | null;
  /** Whether `other` is the element or inside it, where the element can say (the DOM's `contains`). */
  contains?(other: unknown): boolean;
  focus(): void;
}

type Target = () => Focusable | null;

/** Whether `focus()` moved to the element, or into it: always, for an element with no document to ask. */
function tookFocus(element: Focusable): boolean {
  const document = element.ownerDocument;

  if (document === undefined || document === null) return true;

  const active = document.activeElement;

  return active === element || (active !== null && element.contains?.(active) === true);
}

/** The document's focused element as it stands, or `undefined` for an element with no document to ask. */
function activeOf(element: Focusable): unknown {
  return element.ownerDocument?.activeElement;
}

/** Whether focus rests nowhere in particular: no element, or the body. */
function resting(element: Focusable, active: unknown): boolean {
  return active === null || active === undefined || active === element.ownerDocument?.body;
}

/** In the document and not disabled — by itself or by a disabled fieldset around it: an element `focus()` would actually move to. */
function readyOf(target: Target): Focusable | null {
  const element = target();

  return element !== null &&
    element.isConnected &&
    element.disabled !== true &&
    // INSIDE A DISABLED FIELDSET (a dialog's form while its write settles):
    // not ready either, so the wait goes on until the form is enabled again.
    element.matches?.(':disabled') !== true
    ? element
    : null;
}

/**
 * Focus the first ready of `targets`, waiting frame by frame for one to be
 * drawn, and `fallback` when none is ready within `frames` frames.
 */
export function focusLater(
  targets: readonly Target[],
  fallback: Target,
  schedule: (callback: () => void) => unknown = requestAnimationFrame,
  frames: number = FOCUS_FRAMES,
): void {
  attempt(targets, fallback, schedule, frames, NOT_TRIED);
}

/** No focus tried yet: nothing to compare the document's focus with. */
const NOT_TRIED = Symbol('not tried');

/**
 * One frame of {@link focusLater}. `left` is the focused element as the last
 * try that did not take left it — or {@link NOT_TRIED} — so a move made since
 * by somebody else (the user, to another element) is told from our own try.
 */
function attempt(
  targets: readonly Target[],
  fallback: Target,
  schedule: (callback: () => void) => unknown,
  frames: number,
  left: unknown,
): void {
  schedule(() => {
    const found = targets.map(readyOf).find((element) => element !== null);

    if (found !== undefined) {
      const before = activeOf(found);

      // FOCUS MOVED ELSEWHERE since a try that did not take — to an element,
      // not merely to the body: whoever moved it keeps it.
      if (left !== NOT_TRIED && before !== left && !resting(found, before)) return;

      found.focus();

      if (tookFocus(found)) return;

      // NOT TAKEN — the target is still inert behind a modal `<dialog>` that
      // closes in the render's effect, after this frame: the wait goes on, so
      // the dialog's own close never leaves focus on the body; on the last
      // frame, the fallback takes it.
      if (frames > 1) attempt(targets, fallback, schedule, frames - 1, activeOf(found));
      else fallback()?.focus();
    } else if (frames > 1) {
      attempt(targets, fallback, schedule, frames - 1, left);
    } else {
      fallback()?.focus();
    }
  });
}

/** What {@link firstEnabledOf} needs of an element: focus's needs, and its attributes. */
export interface Inspectable extends Focusable {
  getAttribute(name: string): string | null;
}

/**
 * The first of `targets` in the document and enabled — neither `disabled`
 * nor `aria-disabled="true"` — else `null` (story 5.5e): where focus returns
 * when a dialog closes, never a control that would not act on a press.
 */
export function firstEnabledOf<Element extends Inspectable>(
  ...targets: readonly (() => Element | null)[]
): Element | null {
  const ready = targets
    .map((target) => target())
    .find(
      (element) =>
        element !== null &&
        element.isConnected &&
        element.disabled !== true &&
        element.getAttribute('aria-disabled') !== 'true',
    );

  return ready ?? null;
}
