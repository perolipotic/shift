import type { HistoryPeriod } from '@shift/domain';

/**
 * *Povijest promjena*'s page states (story 14.2), named once here so the hook
 * and the components that branch on them hold no literal of their own.
 */

/** A read the page stands on is unanswered: the skeleton. */
export const HISTORY_LOADING = 'loading';
/** The device is offline: one notice, no rows. History is never kept on the device. */
export const HISTORY_OFFLINE = 'offline';
/** A read failed: one alert and a retry. */
export const HISTORY_UNAVAILABLE_STATE = 'unavailable';
/** Every read answered: the chips and the rows. */
export const HISTORY_READY = 'ready';

/** The key a disabled read stands under while the organization's today is unknown. Never fetched. */
export const HISTORY_NO_PERIOD: HistoryPeriod = { from: '', to: '' };
