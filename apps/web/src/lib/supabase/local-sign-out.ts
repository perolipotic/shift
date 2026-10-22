import { supabaseClient } from '@/lib/supabase/client';
import { writesOnline } from '@/lib/offline/use-write-gate';

/** The auth client's own session storage: its key and store, never a key guessed here. */
export interface LocalSessionStore {
  readonly storageKey: string;
  readonly storage: { removeItem(key: string): void | Promise<void> };
}

/**
 * What a sign-out's local fallback reads and clears with (story 8.3a):
 * `@/features/auth/services/sign-out` takes it injected, so the node suite
 * runs every row with a stub (AD-15).
 */
export interface LocalFallback {
  /** Whether the page is online now: offline, the sign-out is local at once. */
  readonly online: () => boolean;
  /**
   * The client's storage. Typed, but CHECKED AT RUNTIME by the sign-out: it
   * is reached through a cast into fields auth-js keeps protected.
   */
  readonly store: () => LocalSessionStore;
  /** The local sign-out's budget; `LOCAL_SIGN_OUT_BUDGET_MS` when absent. */
  readonly budgetMs?: number;
}

/**
 * The page's local sign-out fallback, for both Odjava paths — the chrome's
 * and the set-password step's. ONE ONLINE SOURCE: `writesOnline`, the same
 * freshness clock the write gate reads (`useWriteGate`), so a write refused
 * offline and a sign-out gone local agree on what offline is. auth-js keeps
 * `storageKey` and `storage` on the auth client (protected in its types, so
 * named structurally here, as `./offline-session` reads them): no key is
 * spelled anywhere in the app.
 */
export const pageSignOutFallback: LocalFallback = {
  online: writesOnline,
  store: () => supabaseClient().auth as unknown as LocalSessionStore,
};
