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
  focus(): void;
}

type Target = () => Focusable | null;

/** In the document and not disabled: an element `focus()` would actually move to. */
function readyOf(target: Target): Focusable | null {
  const element = target();

  return element !== null && element.isConnected && element.disabled !== true ? element : null;
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
  schedule(() => {
    const found = targets.map(readyOf).find((element) => element !== null);

    if (found !== undefined) {
      found.focus();
    } else if (frames > 1) {
      focusLater(targets, fallback, schedule, frames - 1);
    } else {
      fallback()?.focus();
    }
  });
}
