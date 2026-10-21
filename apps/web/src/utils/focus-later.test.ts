import { describe, expect, it } from 'vitest';

import { FOCUS_FRAMES, firstEnabledOf, focusLater, type Focusable } from '@/utils/focus-later';

/** A fake element that records whether it took focus. */
function element(name: string, focused: string[], state: { isConnected?: boolean; disabled?: boolean } = {}) {
  return {
    isConnected: state.isConnected ?? true,
    disabled: state.disabled ?? false,
    focus: () => focused.push(name),
  } satisfies Focusable & { isConnected: boolean; disabled: boolean };
}

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

describe('focus after a write waits for its target to be drawn', () => {
  it('focuses nothing before the first frame', () => {
    const focused: string[] = [];
    const clock = frames();

    focusLater([() => element('remove', focused)], () => element('heading', focused), clock.schedule);

    expect(focused).toEqual([]);
    clock.step();
    expect(focused).toEqual(['remove']);
  });

  it('waits for a target the next render draws, not falling to the heading', () => {
    const focused: string[] = [];
    const clock = frames();
    let drawn: Focusable | null = null;

    focusLater([() => drawn], () => element('heading', focused), clock.schedule);
    clock.step();
    clock.step();
    expect(focused).toEqual([]);

    drawn = element('remove', focused);
    clock.step();
    expect(focused).toEqual(['remove']);
    expect(clock.pending).toBe(0);
  });

  it('waits for a control a disabled fieldset still holds, as the DOM\'s :disabled says', () => {
    const focused: string[] = [];
    const clock = frames();
    let inDisabledFieldset = true;
    const field = {
      ...element('from', focused),
      matches: (selector: string) => selector === ':disabled' && inDisabledFieldset,
    };

    focusLater([() => field], () => element('alert', focused), clock.schedule);
    clock.step();
    expect(focused).toEqual([]);

    inDisabledFieldset = false;
    clock.step();
    expect(focused).toEqual(['from']);
  });

  it('focuses again on the next frame when focus did not take, as behind a modal dialog still closing', () => {
    const focused: string[] = [];
    const clock = frames();
    const document = { activeElement: null as unknown };
    let inert = true;
    const button = {
      ...element('edit', focused),
      ownerDocument: document,
      focus(): void {
        focused.push('edit');
        if (!inert) document.activeElement = button;
      },
    };

    focusLater([() => button], () => element('heading', focused), clock.schedule);
    clock.step();
    expect(focused).toEqual(['edit']);
    expect(clock.pending, 'not taken: the wait goes on').toBe(1);

    inert = false;
    clock.step();
    expect(focused).toEqual(['edit', 'edit']);
    expect(document.activeElement).toBe(button);
    expect(clock.pending).toBe(0);
  });

  it('focuses the fallback when focus never took by the last frame', () => {
    const focused: string[] = [];
    const clock = frames();
    const document = { activeElement: null as unknown, body: {} };
    const button = { ...element('edit', focused), ownerDocument: document };

    focusLater([() => button], () => element('heading', focused), clock.schedule, 3);
    clock.step();
    clock.step();
    clock.step();
    expect(focused).toEqual(['edit', 'edit', 'edit', 'heading']);
    expect(clock.pending).toBe(0);
  });

  it('counts focus delegated to an element inside the target as taken', () => {
    const focused: string[] = [];
    const clock = frames();
    const inner = {};
    const document = { activeElement: null as unknown };
    const card = {
      ...element('card', focused),
      ownerDocument: document,
      contains: (other: unknown) => other === inner,
      focus(): void {
        focused.push('card');
        document.activeElement = inner;
      },
    };

    focusLater([() => card], () => element('heading', focused), clock.schedule);
    clock.step();
    expect(focused).toEqual(['card']);
    expect(clock.pending, 'taken: no retry').toBe(0);
  });

  it('stops retrying once somebody else has moved focus to another element', () => {
    const focused: string[] = [];
    const clock = frames();
    const body = {};
    const document = { activeElement: body as unknown, body };
    const button = { ...element('edit', focused), ownerDocument: document };

    focusLater([() => button], () => element('heading', focused), clock.schedule);
    clock.step();
    expect(focused).toEqual(['edit']);
    expect(clock.pending).toBe(1);

    // The user tabs to a link meanwhile.
    document.activeElement = { name: 'link' };
    clock.step();
    expect(focused, 'no second try, and no fallback').toEqual(['edit']);
    expect(clock.pending).toBe(0);
  });

  it('keeps retrying while focus merely rests on the body', () => {
    const focused: string[] = [];
    const clock = frames();
    const body = {};
    const document = { activeElement: { name: 'opener' } as unknown, body };
    let inert = true;
    const button = {
      ...element('edit', focused),
      ownerDocument: document,
      focus(): void {
        focused.push('edit');
        if (!inert) document.activeElement = button;
      },
    };

    focusLater([() => button], () => element('heading', focused), clock.schedule);
    clock.step();
    // The modal dialog closes and focus falls to the body: not somebody else's move.
    document.activeElement = body;
    inert = false;
    clock.step();
    expect(focused).toEqual(['edit', 'edit']);
    expect(document.activeElement).toBe(button);
  });

  it('takes the first ready target in order, skipping a detached or disabled one', () => {
    const focused: string[] = [];
    const clock = frames();

    focusLater(
      [
        () => element('detached', focused, { isConnected: false }),
        () => element('disabled', focused, { disabled: true }),
        () => null,
        () => element('type', focused),
        () => element('later', focused),
      ],
      () => element('heading', focused),
      clock.schedule,
    );
    clock.step();

    expect(focused).toEqual(['type']);
  });

  it('waits for a disabled target to be enabled', () => {
    const focused: string[] = [];
    const clock = frames();
    let disabled = true;

    focusLater([() => element('remove', focused, { disabled })], () => element('heading', focused), clock.schedule);
    clock.step();
    expect(focused).toEqual([]);

    disabled = false;
    clock.step();
    expect(focused).toEqual(['remove']);
  });

  it('gives focus to the fallback when no target is ready within the frame budget', () => {
    const focused: string[] = [];
    const clock = frames();

    focusLater([() => null], () => element('heading', focused), clock.schedule);
    for (let frame = 1; frame < FOCUS_FRAMES; frame += 1) clock.step();
    expect(focused).toEqual([]);

    clock.step();
    expect(focused).toEqual(['heading']);
    expect(clock.pending).toBe(0);
  });

  it('focuses nothing when the fallback is gone too', () => {
    const focused: string[] = [];
    const clock = frames();

    focusLater([() => null], () => null, clock.schedule, 1);
    clock.step();

    expect(focused).toEqual([]);
    expect(clock.pending).toBe(0);
  });
});

describe('firstEnabledOf', () => {
  /** A fake element with attributes. */
  function inspectable(name: string, state: { isConnected?: boolean; disabled?: boolean; ariaDisabled?: string } = {}) {
    return {
      name,
      isConnected: state.isConnected ?? true,
      disabled: state.disabled ?? false,
      getAttribute: (attribute: string) => (attribute === 'aria-disabled' ? (state.ariaDisabled ?? null) : null),
      focus: () => undefined,
    };
  }

  it('skips a detached, a disabled and an aria-disabled target, and answers the first ready one', () => {
    const ready = inspectable('ready');

    expect(
      firstEnabledOf(
        () => null,
        () => inspectable('detached', { isConnected: false }),
        () => inspectable('disabled', { disabled: true }),
        () => inspectable('aria', { ariaDisabled: 'true' }),
        () => ready,
      ),
    ).toBe(ready);
  });

  it('answers null when none is ready', () => {
    expect(firstEnabledOf(() => inspectable('aria', { ariaDisabled: 'true' }))).toBeNull();
  });
});
