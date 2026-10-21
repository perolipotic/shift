import { describe, expect, it } from 'vitest';

import { keepFocusOnAlertWith, type RetryAlert } from '@/utils/retry-focus';

/** A frame scheduler the test steps one frame at a time. */
function frames() {
  let queue: (() => void)[] = [];

  return {
    schedule: (callback: () => void) => queue.push(callback),
    step(): void {
      const due = queue;

      queue = [];
      due.forEach((callback) => callback());
    },
    get pending(): number {
      return queue.length;
    },
  };
}

/** A card holding an alert and a retry button, as the unavailable states draw them. */
function wired(state: { tabIndexSet?: boolean } = {}) {
  const body = { name: 'body' };
  const document = { activeElement: null as unknown, body };
  const attributes = new Set<string>(state.tabIndexSet === true ? ['tabindex'] : []);
  let tabIndex = state.tabIndexSet === true ? 0 : -1;
  const alert: RetryAlert = {
    isConnected: true,
    ownerDocument: document,
    hasAttribute: (name: string) => attributes.has(name),
    // Setting `tabIndex` sets the attribute, as the DOM does.
    get tabIndex(): number {
      return tabIndex;
    },
    set tabIndex(value: number) {
      tabIndex = value;
      attributes.add('tabindex');
    },
    focus(): void {
      document.activeElement = alert;
    },
  };
  const parent = {
    isConnected: true,
    alertDrawn: true,
    found: null as unknown,
    querySelector(selector: string): unknown {
      if (selector !== '[role="alert"]') return null;
      if (parent.found !== null) return parent.found;

      return parent.alertDrawn ? alert : null;
    },
  };
  const button: { ownerDocument: typeof document | null; parentElement: typeof parent | null } = {
    ownerDocument: document,
    parentElement: parent,
  };

  return { document, body, alert, parent, button, attributes };
}

describe('a read retry that leaves while focused hands focus to its alert', () => {
  it('focuses the alert in the button\'s parent, on the next frame, made focusable', () => {
    const clock = frames();
    const { document, alert, button } = wired();
    const cleanup = keepFocusOnAlertWith(clock.schedule)(button);

    document.activeElement = button;
    cleanup?.();
    expect(document.activeElement, 'nothing before the frame').toBe(button);

    clock.step();
    expect(document.activeElement).toBe(alert);
    expect(alert.tabIndex).toBe(-1);
    expect(alert.hasAttribute('tabindex')).toBe(true);
  });

  it('keeps an alert\'s own tabIndex', () => {
    const clock = frames();
    const { document, alert, button } = wired({ tabIndexSet: true });
    const cleanup = keepFocusOnAlertWith(clock.schedule)(button);

    document.activeElement = button;
    cleanup?.();
    clock.step();
    expect(document.activeElement).toBe(alert);
    expect(alert.tabIndex).toBe(0);
  });

  it('does nothing when the button leaves without focus', () => {
    const clock = frames();
    const { document, button } = wired();
    const elsewhere = { name: 'link' };
    const cleanup = keepFocusOnAlertWith(clock.schedule)(button);

    document.activeElement = elsewhere;
    cleanup?.();
    expect(clock.pending).toBe(0);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('does nothing when the alert left too, as after a retry that succeeded', () => {
    const clock = frames();
    const { document, parent, button } = wired();
    const cleanup = keepFocusOnAlertWith(clock.schedule, 3)(button);

    document.activeElement = button;
    cleanup?.();
    parent.isConnected = false;
    clock.step();
    clock.step();
    clock.step();
    expect(clock.pending).toBe(0);
    expect(document.activeElement, 'no focus action, and no fallback').toBe(button);
  });

  it('does nothing when the parent stays but holds no alert any more', () => {
    const clock = frames();
    const { document, parent, button } = wired();
    const cleanup = keepFocusOnAlertWith(clock.schedule, 2)(button);

    document.activeElement = button;
    cleanup?.();
    parent.alertDrawn = false;
    clock.step();
    clock.step();
    expect(clock.pending).toBe(0);
    expect(document.activeElement).toBe(button);
  });

  it('returns no cleanup for a detached ref', () => {
    expect(keepFocusOnAlertWith(frames().schedule)(null)).toBeUndefined();
  });

  it('makes the alert focusable only as it focuses it, not while it is looked for', () => {
    const clock = frames();
    const { document, alert, attributes, button } = wired();
    let focusable: boolean | null = null;
    const focus = alert.focus.bind(alert);

    alert.focus = () => {
      focusable = attributes.has('tabindex');
      focus();
    };
    const cleanup = keepFocusOnAlertWith(clock.schedule)(button);

    document.activeElement = button;
    cleanup?.();
    expect(attributes.has('tabindex'), 'set before any frame').toBe(false);
    clock.step();
    expect(focusable, 'not focusable when focused').toBe(true);
  });

  it('waits for an alert drawn on a later frame within the budget', () => {
    const clock = frames();
    const { document, alert, parent, button } = wired();
    const cleanup = keepFocusOnAlertWith(clock.schedule, 5)(button);

    document.activeElement = button;
    cleanup?.();
    parent.alertDrawn = false;
    clock.step();
    clock.step();
    expect(document.activeElement).toBe(button);

    parent.alertDrawn = true;
    clock.step();
    expect(document.activeElement).toBe(alert);
    expect(clock.pending).toBe(0);
  });

  it('falls back to the parent it was mounted in when it has none at cleanup', () => {
    const clock = frames();
    const { document, alert, button } = wired();
    const cleanup = keepFocusOnAlertWith(clock.schedule)(button);

    document.activeElement = button;
    button.parentElement = null;
    cleanup?.();
    clock.step();
    expect(document.activeElement).toBe(alert);
  });

  it('ignores a candidate that is not an element it can focus', () => {
    const clock = frames();
    const { document, parent, button } = wired();
    const cleanup = keepFocusOnAlertWith(clock.schedule, 2)(button);

    parent.found = { name: 'not an element' };
    document.activeElement = button;
    cleanup?.();
    clock.step();
    clock.step();
    expect(clock.pending).toBe(0);
    expect(document.activeElement).toBe(button);
  });

  it('does nothing for a button with no document', () => {
    const clock = frames();
    const { button } = wired();
    const cleanup = keepFocusOnAlertWith(clock.schedule)(button);

    button.ownerDocument = null;
    cleanup?.();
    expect(clock.pending).toBe(0);
  });

  it('leaves focus the person moved elsewhere before the first frame', () => {
    const clock = frames();
    const { document, button } = wired();
    const link = { name: 'link' };
    const cleanup = keepFocusOnAlertWith(clock.schedule, 3)(button);

    document.activeElement = button;
    cleanup?.();
    document.activeElement = link;
    clock.step();
    clock.step();
    clock.step();
    expect(document.activeElement).toBe(link);
    expect(clock.pending).toBe(0);
  });

  it('still focuses the alert once focus fell from the removed button to the body', () => {
    const clock = frames();
    const { document, body, alert, button } = wired();
    const cleanup = keepFocusOnAlertWith(clock.schedule)(button);

    document.activeElement = button;
    cleanup?.();
    document.activeElement = body;
    clock.step();
    expect(document.activeElement).toBe(alert);
  });
});
