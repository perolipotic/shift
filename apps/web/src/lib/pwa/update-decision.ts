/**
 * When the update notice may reload the page (story 8.1).
 *
 * In `prompt` mode `vite-plugin-pwa` calls `onNeedReload` in EVERY tab that saw
 * the waiting worker, once the new worker takes control — and without
 * `onNeedReload` it reloads them all. So a tap on *Osvježi* in one tab would
 * reload another tab mid-task, with whatever the member had typed there. This
 * decides per tab: the page reloads only after a tap in this tab.
 *
 * Note that `updateServiceWorker(true)` ignores its argument: it only asks the
 * waiting worker to skip waiting, and the reload comes from `controlling`. Once
 * another tab has done that there is no waiting worker left to ask, so a later
 * tap here reloads directly.
 */
export interface UpdateState {
  /** The member tapped *Osvježi* in this tab. */
  readonly tapped: boolean;
  /** The new worker took control without a tap here (another tab's tap). */
  readonly activatedElsewhere: boolean;
}

/** What the notice does next: ask the waiting worker to take over, reload, or nothing. */
export type UpdateAction = 'skip-waiting' | 'reload' | 'none';

export const INITIAL_UPDATE_STATE: UpdateState = { tapped: false, activatedElsewhere: false };

/** The member tapped *Osvježi* in this tab. */
export function onUpdateTap(state: UpdateState): { state: UpdateState; action: UpdateAction } {
  return {
    state: { ...state, tapped: true },
    action: state.activatedElsewhere ? 'reload' : 'skip-waiting',
  };
}

/** The new worker took control of this tab (`onNeedReload`). */
export function onNewWorkerControlling(state: UpdateState): { state: UpdateState; action: UpdateAction } {
  if (state.tapped) return { state, action: 'reload' };

  return { state: { ...state, activatedElsewhere: true }, action: 'none' };
}

/** Carries out an action with this tab's effects. */
export function performUpdateAction(
  action: UpdateAction,
  effects: { readonly reload: () => void; readonly skipWaiting: () => void },
): void {
  if (action === 'reload') effects.reload();
  if (action === 'skip-waiting') effects.skipWaiting();
}

/** The slice of `document` the update check reads, so the node suite can stand one in. */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Checks for a new worker each time the page becomes visible again.
 *
 * An installed app resumed from the background reloads nothing, and SPA
 * navigation fetches no document, so the browser would not look for a new
 * worker until the app is closed. No polling: a check costs a request, and a
 * member returning to the app is the moment a new version matters.
 */
export function checkForUpdatesOnResume(
  registration: Pick<ServiceWorkerRegistration, 'update'> | undefined,
  source: VisibilitySource,
  onFailure: (cause: unknown) => void,
): void {
  if (registration === undefined) return;

  source.addEventListener('visibilitychange', () => {
    if (source.visibilityState !== 'visible') return;
    registration.update().catch(onFailure);
  });
}
