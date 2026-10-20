import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { onlineManager } from '@tanstack/react-query';

import { SESSION_UNREADABLE, SESSION_UNRESOLVED, supabaseClient } from '@/lib/supabase/client';
import { READ_TIME_BUDGET_MS, withinTimeBudget } from '@/utils/time-budget';

/**
 * THE SESSION FOR OFFLINE READING (story 8.2, human decision 2026-10-20 a).
 *
 * Offline, with an access token past its expiry, `getSession` cannot refresh
 * it: auth-js 2.113.0's `__loadSession` tries, fails with a RETRYABLE fetch
 * error, answers `session: null` — and keeps the session in storage, because
 * nobody signed out. Read as "signed out", that null deleted the device's
 * snapshot and sent the member to sign in, on a truck, an hour after their
 * last token: the story's own case. So for READ purposes, and only while
 * TanStack's `onlineManager` says offline, an UNRESOLVED session — a
 * retryable or network failure, or a read that never settled — is the
 * session Supabase still holds in storage.
 *
 * NOTHING HERE SIGNS ANYBODY IN OR OUT, and nothing writes the session. A
 * session that is confirmed absent (no error, no session) is absent offline
 * too; a non-retryable failure is not unresolved. On reconnect the client's
 * own refresh decides: a real sign-out arrives as `SIGNED_OUT`, which deletes
 * the snapshot as always.
 *
 * WHY THE STORED TOKEN IS CHECKED FIRST. Offline, a refresh cannot succeed,
 * and auth-js retries it with back-off for up to ~30 s; every guard would
 * wait out its whole time budget before the answer this module gives anyway.
 * So offline, a stored session whose access token is within auth-js's own
 * expiry margin is answered at once, without asking `getSession`.
 *
 * THE STORAGE IS A SEAM ({@link StoredSessionStore}): the client's own
 * `storageKey` and `storage`, never a key guessed here. `./client`'s binding
 * is the one place that reaches into the client for them, and the node
 * suite executes every rule with a stub (AD-15).
 */

/** As much of the auth client's storage as reading the stored session needs. */
export interface StoredSessionStore {
  /** The key the client keeps its session under (`auth.storageKey`). */
  readonly storageKey: string;
  readonly storage: { getItem(key: string): string | null | Promise<string | null> };
}

/** As much of `supabase.auth` as reading the live session needs. */
export interface LiveSessionSource {
  getSession(): Promise<{ data: { session: Session | null }; error: unknown }>;
}

/** auth-js's own margin (`EXPIRY_MARGIN_MS`): a token this close to its expiry is refreshed before use. */
export const TOKEN_EXPIRY_MARGIN_MS = 3 * 30 * 1000;

/**
 * The session the client keeps in storage, or `null`: none, unreadable, or
 * not a session with a user id. Never rejects.
 */
export async function storedSessionOf(store: () => StoredSessionStore): Promise<Session | null> {
  try {
    const source = store();
    const raw = await source.storage.getItem(source.storageKey);

    if (typeof raw !== 'string') return null;

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) return null;

    const user = (parsed as { user?: unknown }).user;
    const id = typeof user === 'object' && user !== null ? (user as { id?: unknown }).id : undefined;

    return typeof id === 'string' && id !== '' ? (parsed as Session) : null;
  } catch {
    return null;
  }
}

/** Whether a session's access token is expired, or within auth-js's refresh margin, at `now`. */
export function accessTokenExpired(session: Session, now: number): boolean {
  return typeof session.expires_at === 'number' && session.expires_at * 1000 - now < TOKEN_EXPIRY_MARGIN_MS;
}

/** What {@link sessionForReads} reads with. */
export interface SessionForReadsSources {
  readonly live: () => LiveSessionSource;
  readonly stored: () => StoredSessionStore;
  /** `onlineManager.isOnline()`. */
  readonly online: () => boolean;
  readonly now?: () => number;
}

/** The session is known: the live one, or offline the stored one. */
export const SESSION_KNOWN = 'known';
/** Nobody is signed in, confirmed: no session and no error, or a refresh refused for good. */
export const SESSION_NONE = 'none';
/** The read did not settle on an answer: a time-out, or a retryable failure while online. */
export const SESSION_UNRESOLVED_STATE = 'unresolved';

export type SessionState =
  | { readonly kind: typeof SESSION_KNOWN; readonly session: Session }
  | { readonly kind: typeof SESSION_NONE }
  | { readonly kind: typeof SESSION_UNRESOLVED_STATE; readonly cause: unknown };

/**
 * THE THREE ANSWERS a session read can give, for reading. Only NONE is a
 * confirmed sign-out — the one answer that may delete the device's copy;
 * UNRESOLVED is neither a session nor a sign-out. Offline, an unresolved
 * read is the stored session (KNOWN), or NONE when nothing is stored.
 * Never rejects.
 */
export function sessionStateForReads(
  sources: SessionForReadsSources,
  budgetMs: number = READ_TIME_BUDGET_MS,
): () => Promise<SessionState> {
  const now = sources.now ?? Date.now;
  const live = withinTimeBudget(() => sources.live().getSession(), budgetMs);
  const fromStorage = async (): Promise<SessionState> => {
    const stored = await storedSessionOf(sources.stored);

    return stored === null ? { kind: SESSION_NONE } : { kind: SESSION_KNOWN, session: stored };
  };

  return async () => {
    if (!sources.online()) {
      const stored = await storedSessionOf(sources.stored);

      // A refresh cannot succeed offline: answer now, not after the budget.
      if (stored !== null && accessTokenExpired(stored, now())) return { kind: SESSION_KNOWN, session: stored };
    }

    let answered: Awaited<ReturnType<LiveSessionSource['getSession']>>;

    try {
      answered = await live();
    } catch (cause) {
      return sources.online() ? { kind: SESSION_UNRESOLVED_STATE, cause } : fromStorage();
    }

    const { session } = answered.data;

    if (session !== null) return { kind: SESSION_KNOWN, session };
    if (answered.error === null || answered.error === undefined) return { kind: SESSION_NONE };

    if (isAuthRetryableFetchError(answered.error)) {
      return sources.online() ? { kind: SESSION_UNRESOLVED_STATE, cause: answered.error } : fromStorage();
    }

    // Refused for good: auth-js has removed the session itself.
    console.error(SESSION_UNREADABLE, answered.error);

    return { kind: SESSION_NONE };
  };
}

/**
 * The session for reading, in `currentSession`'s shape for the guards: the
 * session, `null` for a confirmed nobody, and a REJECTION for an unresolved
 * read — which every guard's `resolvedSession` logs and fails closed on, as
 * it does for `currentSession`'s own time-out.
 */
export function sessionForReads(
  sources: SessionForReadsSources,
  budgetMs: number = READ_TIME_BUDGET_MS,
): () => Promise<Session | null> {
  const read = sessionStateForReads(sources, budgetMs);

  return async () => {
    const state = await read();

    if (state.kind === SESSION_KNOWN) return state.session;
    if (state.kind === SESSION_NONE) return null;

    throw state.cause;
  };
}

/**
 * `main.tsx`'s restore, on the session's three answers: KNOWN restores for
 * its user, NONE deletes the device's copy (a confirmed sign-out), and
 * UNRESOLVED does neither. Never rejects.
 */
export async function restoreForBoot(
  read: () => Promise<SessionState>,
  restore: (userId: string | null) => Promise<void>,
): Promise<void> {
  const state = await read();

  if (state.kind === SESSION_KNOWN) await restore(state.session.user.id);
  else if (state.kind === SESSION_NONE) await restore(null);
  else console.error(SESSION_UNRESOLVED, state.cause);
}

/**
 * The user a session change ANNOUNCED AS NOBODY still is, for reading: the
 * stored session's user while offline, or `null` — for `resetOnSessionChange`,
 * whose `INITIAL_SESSION` arrives as `null` offline with an expired token
 * (auth-js emits it with `null` on the retryable error). Never rejects.
 */
export function offlineStoredUser(sources: Pick<SessionForReadsSources, 'stored' | 'online'>): () => Promise<string | null> {
  return async () => {
    if (sources.online()) return null;

    try {
      return (await storedSessionOf(sources.stored))?.user.id ?? null;
    } catch (cause) {
      console.error(SESSION_UNRESOLVED, cause);

      return null;
    }
  };
}

// ----------------------------------------------------------------- bindings

/**
 * THE ONE PLACE that reaches into the client for its storage: auth-js keeps
 * `storageKey` and `storage` on the auth client (protected in its types, so
 * named structurally here). No key is spelled anywhere in the app.
 */
const clientStore = (): StoredSessionStore => supabaseClient().auth as unknown as StoredSessionStore;

const pageSources = {
  live: () => supabaseClient().auth as unknown as LiveSessionSource,
  stored: clientStore,
  online: () => onlineManager.isOnline(),
};

/** The bound reader the offline-readable guards read through. */
export const currentSessionForReads = sessionForReads(pageSources);

/**
 * How long the first render waits on the session before the restore: an
 * online cold start with an expired token waits on a refresh, which must not
 * hold first paint for a guard's whole budget. Unresolved within it, the app
 * renders without restoring, and the session events reconcile.
 */
export const BOOT_SESSION_BUDGET_MS = 1500;

/** The bound boot read: `main.tsx`'s restore decides on its three answers. */
export const bootSessionState = sessionStateForReads(pageSources, BOOT_SESSION_BUDGET_MS);

/** The bound stored user, for `resetOnSessionChange`'s first event. */
export const offlineSessionUser = offlineStoredUser(pageSources);
