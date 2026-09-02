/// <reference types="vite/client" />

/**
 * The build-time environment contract (AD-17). Cloudflare Pages supplies these
 * per environment; see DEPLOY.md. The secret key (`sb_secret_*`) is absent by
 * design — it exists only in the `admin-auth` function's environment.
 */
interface ImportMetaEnv {
  /** Supabase project URL for this environment. */
  readonly VITE_SUPABASE_URL: string;
  /** Publishable key only — must match `sb_publishable_*`. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
