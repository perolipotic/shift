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

/** The offline write note (story 8.3a): *Za ovo je potrebna veza.* inside `scope`. */
export function offlineWriteNoteIn(scope: Page | Locator): Locator {
  return scope.getByRole('status').filter({ hasText: hr.offline.needsConnection });
}

/** The prefix of every offline write note's id (`useWriteGate`'s `offline-write-{useId}`). */
const OFFLINE_WRITE_NOTE_ID_PREFIX = 'offline-write-';

/**
 * A CSS string's escape for an attribute value in double quotes — the
 * equivalent of `CSS.escape` for this use, which Node does not have: a
 * backslash and a double quote are escaped, and a line break is written as
 * its code point.
 */
function cssStringOf(value: string): string {
  return value.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
}

/**
 * The offline write note `control` names in its `aria-describedby` (story
 * 8.3b), where a screen draws more than one: the description is split on
 * whitespace and the id with the note's prefix picked. Throws when the
 * control names no such note — the caller asserts the gate first.
 */
export async function offlineWriteNoteNamedBy(page: Page, control: Locator): Promise<Locator> {
  const ids = ((await control.getAttribute('aria-describedby')) ?? '').split(/\s+/);
  const id = ids.find((each) => each.startsWith(OFFLINE_WRITE_NOTE_ID_PREFIX));
  if (id === undefined) throw new Error('E2E: the control names no offline write note');

  return offlineWriteNoteIn(page).and(page.locator(`[id="${cssStringOf(id)}"]`));
}

/** The sign-in's offline note (story 8.3a): *Za prijavu je potrebna veza.* */
export function offlineSignInNoteOf(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: hr.offline.signInNeedsConnection });
}

/** One query the device snapshot holds: its key and its data. */
export interface SnapshotQuery {
  readonly queryKey: readonly unknown[];
  readonly data: unknown;
}

/** The device snapshot as IndexedDB holds it: whose it is (`buster`, the auth user id) and its queries. */
export interface DeviceSnapshot {
  readonly owner: string;
  readonly queries: readonly SnapshotQuery[];
}

/**
 * The device snapshot kept in IndexedDB for offline reading (story 8.2), read
 * straight from the database the app writes — `shift` / `query-cache`, under
 * `shift-query-cache` (`apps/web/src/lib/offline/device-snapshot.ts`,
 * `DEVICE_SNAPSHOT_KEY`) — or `null` when there is none: no database, no
 * `query-cache` store, or no entry. Never creates either. A stored value that
 * is not a string THROWS.
 */
export async function deviceSnapshotOf(page: Page): Promise<DeviceSnapshot | null> {
  const raw = await page.evaluate(
    () =>
      new Promise<{ kind: 'none' } | { kind: 'value'; value: unknown }>((resolve, reject) => {
        const request = indexedDB.open('shift');
        // NO DATABASE YET: never create one here (the app's own first open
        // creates its store); abort, and there is no snapshot.
        request.onupgradeneeded = () => {
          request.transaction?.abort();
        };
        request.onerror = () => {
          if (request.error?.name === 'AbortError') resolve({ kind: 'none' });
          else reject(request.error ?? new Error('IndexedDB open failed'));
        };
        request.onsuccess = () => {
          const database = request.result;

          if (!database.objectStoreNames.contains('query-cache')) {
            database.close();
            resolve({ kind: 'none' });

            return;
          }

          const read = database.transaction('query-cache', 'readonly').objectStore('query-cache').get('shift-query-cache');
          read.onerror = () => {
            database.close();
            reject(read.error ?? new Error('IndexedDB read failed'));
          };
          read.onsuccess = () => {
            database.close();
            resolve(read.result === undefined ? { kind: 'none' } : { kind: 'value', value: read.result });
          };
        };
      }),
  );

  if (raw.kind === 'none') return null;
  // FAIL LOUDLY: the app writes a JSON string, and anything else is a format this reader no longer knows.
  if (typeof raw.value !== 'string') throw new Error(`E2E: the device snapshot is a ${typeof raw.value}, not a string`);

  const parsed = JSON.parse(raw.value) as {
    buster?: string;
    clientState?: { queries?: { queryKey: unknown[]; state?: { data?: unknown } }[] };
  };

  return {
    owner: parsed.buster ?? '',
    queries: (parsed.clientState?.queries ?? []).map((query) => ({ queryKey: query.queryKey, data: query.state?.data })),
  };
}

/** The data the snapshot holds under the one-part key `[root]`, or `undefined`. */
export function snapshotDataOf(snapshot: DeviceSnapshot, root: string): unknown {
  return snapshot.queries.find((query) => query.queryKey.length === 1 && query.queryKey[0] === root)?.data;
}
