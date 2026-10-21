/**
 * Focus that outlives a read-retry button (story 8.2e), as a pure module (AD-15).
 *
 * Offline, no surface offers *Pokušaj ponovno*: its `refetch()` would pause
 * until the connection returns, so a press would do nothing visible. A retry
 * button that HAD focus when the connection dropped unmounts with it, and the
 * browser drops focus to `<body>`. {@link keepFocusOnAlert} is the button's
 * ref callback: when the button leaves while focused, focus moves to the
 * `[role="alert"]` it sat beside — the message that still explains the state.
 *
 * A React 19 ref callback: the cleanup it returns runs as the button leaves,
 * before React removes it from the document, so whether it holds focus and
 * which element is its parent can still be asked then. When the alert left as
 * well (a retry that succeeded, the whole state replaced), it does nothing:
 * whatever the new render draws owns focus. The frame scheduler is injectable,
 * as `focusLater`'s is, so a test can step it.
 */

import { focusLater, type Focusable } from '@/utils/focus-later';

/** What the helper needs of the alert: focus's needs, and whether it can take focus. */
export interface RetryAlert extends Focusable {
  hasAttribute(name: string): boolean;
  tabIndex: number;
}

/** What the helper needs of the button's parent: whether it is drawn, and its alert. */
export interface RetryParent {
  readonly isConnected: boolean;
  querySelector(selector: string): unknown;
}

/** What the helper needs of the retry button. */
export interface RetryButton {
  readonly ownerDocument: { readonly activeElement: unknown; readonly body?: unknown } | null;
  readonly parentElement: RetryParent | null;
}

const ALERT = '[role="alert"]';

/** Whether a found element can take focus as an alert. */
function isAlert(element: unknown): element is RetryAlert {
  return (
    typeof element === 'object' &&
    element !== null &&
    typeof (element as { focus?: unknown }).focus === 'function' &&
    typeof (element as { hasAttribute?: unknown }).hasAttribute === 'function'
  );
}

/** The alert in `parent` while both are drawn, else `null`. Finding it changes nothing. */
function alertIn(parent: RetryParent): RetryAlert | null {
  if (!parent.isConnected) return null;

  const alert = parent.querySelector(ALERT);

  return isAlert(alert) && alert.isConnected ? alert : null;
}

/**
 * The alert as `focusLater` focuses it: made focusable (`tabIndex=-1`, when it
 * has no `tabindex` of its own) just before its focus, never while it is only
 * looked for. Focus taken by the alert counts as taken.
 */
function focusTargetOf(alert: RetryAlert): Focusable {
  return {
    get isConnected() {
      return alert.isConnected;
    },
    ownerDocument: alert.ownerDocument ?? null,
    contains: (other: unknown) => other === alert || alert.contains?.(other) === true,
    focus(): void {
      if (!alert.hasAttribute('tabindex')) alert.tabIndex = -1;
      alert.focus();
    },
  };
}

/**
 * Whether somebody moved focus on since the button left: focus rests on an
 * element that is neither the body nor the button itself.
 */
function movedElsewhere(button: RetryButton): boolean {
  const document = button.ownerDocument;
  const active = document?.activeElement;

  return active !== null && active !== undefined && active !== document?.body && active !== button;
}

/**
 * {@link keepFocusOnAlert} with the frame scheduler and frame budget injected,
 * for a test to step.
 */
export function keepFocusOnAlertWith(
  schedule: (callback: () => void) => unknown,
  frames?: number,
): (button: RetryButton | null) => (() => void) | undefined {
  return (button) => {
    if (button === null) return undefined;

    const mountedParent = button.parentElement;

    return () => {
      // ONLY A FOCUSED BUTTON: one that leaves unfocused leaves focus where it is.
      if (button.ownerDocument?.activeElement !== button) return;

      const parent = button.parentElement ?? mountedParent;

      if (parent === null) return;

      // NO FALLBACK: with the alert gone too, the new render owns focus. And
      // FOCUS MOVED ON meanwhile — by the person, to another element — is
      // theirs: the alert is not looked for (`focusLater` itself guards the
      // tries after the first).
      focusLater(
        [
          () => {
            if (movedElsewhere(button)) return null;

            const alert = alertIn(parent);

            return alert === null ? null : focusTargetOf(alert);
          },
        ],
        () => null,
        schedule,
        frames,
      );
    };
  };
}

/**
 * The read-retry button's ref callback (story 8.2e): when the button unmounts
 * while it has focus, focus moves to the `[role="alert"]` in its parent.
 */
export const keepFocusOnAlert: (button: HTMLButtonElement | null) => (() => void) | undefined =
  keepFocusOnAlertWith((callback) => requestAnimationFrame(callback));
