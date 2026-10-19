import { describe, expect, it, vi } from 'vitest';

import {
  checkForUpdatesOnResume,
  INITIAL_UPDATE_STATE,
  onNewWorkerControlling,
  onUpdateTap,
  performUpdateAction,
  type VisibilitySource,
} from '@/lib/pwa/update-decision';

describe('a new version reloads only the tab whose member tapped', () => {
  it('asks the waiting worker to take over on a tap, then reloads when it does', () => {
    const tap = onUpdateTap(INITIAL_UPDATE_STATE);
    expect(tap.action).toBe('skip-waiting');

    expect(onNewWorkerControlling(tap.state).action).toBe('reload');
  });

  it('does not reload when another tab activated the worker, and the notice stays', () => {
    const controlled = onNewWorkerControlling(INITIAL_UPDATE_STATE);

    expect(controlled.action).toBe('none');
    expect(controlled.state.activatedElsewhere).toBe(true);
  });

  it('reloads directly on a tap after another tab activated the worker', () => {
    const controlled = onNewWorkerControlling(INITIAL_UPDATE_STATE);

    expect(onUpdateTap(controlled.state).action).toBe('reload');
  });
});

describe('an action is carried out with the tab\'s own effects', () => {
  it.each([
    ['reload', 1, 0],
    ['skip-waiting', 0, 1],
    ['none', 0, 0],
  ] as const)('%s', (action, reloads, skips) => {
    const reload = vi.fn();
    const skipWaiting = vi.fn();

    performUpdateAction(action, { reload, skipWaiting });

    expect(reload).toHaveBeenCalledTimes(reloads);
    expect(skipWaiting).toHaveBeenCalledTimes(skips);
  });
});

describe('a resumed app checks for a new worker', () => {
  function fakeDocument(): VisibilitySource & { visibilityState: DocumentVisibilityState; fire(): void } {
    const listeners: (() => void)[] = [];
    return {
      visibilityState: 'hidden',
      addEventListener: (_type, listener) => void listeners.push(listener),
      fire: () => listeners.forEach((listener) => listener()),
    };
  }

  it('checks when the page becomes visible, not when it is hidden', () => {
    const doc = fakeDocument();
    const update = vi.fn(() => Promise.resolve());

    checkForUpdatesOnResume({ update } as never, doc, () => undefined);
    doc.fire();
    expect(update).not.toHaveBeenCalled();

    doc.visibilityState = 'visible';
    doc.fire();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('reports a failed check instead of rejecting', async () => {
    const doc = fakeDocument();
    const cause = new Error('offline');
    const onFailure = vi.fn();

    checkForUpdatesOnResume({ update: () => Promise.reject(cause) } as never, doc, onFailure);
    doc.visibilityState = 'visible';
    doc.fire();
    await Promise.resolve();
    await Promise.resolve();

    expect(onFailure).toHaveBeenCalledWith(cause);
  });

  it('does nothing without a registration', () => {
    const doc = fakeDocument();
    const addEventListener = vi.spyOn(doc, 'addEventListener');

    checkForUpdatesOnResume(undefined, doc, () => undefined);

    expect(addEventListener).not.toHaveBeenCalled();
  });
});
