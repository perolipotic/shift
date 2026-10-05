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
