/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/**
 * The build-time environment contract (AD-17). Cloudflare Pages supplies these
 * per environment; see DEPLOY.md. The secret key (`sb_secret_*`) is absent by
 * design — it exists only in the Edge Functions' environment.
 */
interface ImportMetaEnv {
  /** Supabase project URL for this environment. */
  readonly VITE_SUPABASE_URL: string;
  /** Publishable key only — must match `sb_publishable_*`. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  /**
   * Story 10.4 (AD-17, amended): the VAPID PUBLIC key, unpadded base64url,
   * that a device subscribes to push under. Public by design; the private key
   * exists only in `notify`'s environment. Absent, push cannot be turned on.
   */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
