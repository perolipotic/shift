import type { Locator, Page } from '@playwright/test';

import { escapeRegExp, hr } from './i18n.ts';

/** `Bez veze · stanje od ` and a binding date and time, as the whole status (story 8.2). */
export const OFFLINE_NOTE = new RegExp(
  `^${escapeRegExp(hr.offline.asOf.split('{')[0] ?? '')}\\d{2}\\.\\d{2}\\.\\d{4} \\d{2}:\\d{2}$`,
);

/** The as-of note on any screen: the status under the heading while a snapshot is drawn offline. */
export function offlineNoteOf(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: OFFLINE_NOTE });
}
