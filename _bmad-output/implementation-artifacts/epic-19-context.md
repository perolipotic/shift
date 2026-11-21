# Epic 19 Context: An organization signs itself up

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let an organization start using Shift with nobody at Shift involved. A stranger creates an account, verifies the email, founds an organization as its first admin (the Founding Admin), and is walked through hour bands, teams, shift types, a rotation with its coverage preview, and members. Nothing is pre-filled and there is no billing. Signup is a second way into the same provisioning that operators already use, and operator provisioning keeps working unchanged. The epic ships to staging only. Opening production is a separate founder decision (D-S5), taken after a security review of 19.1–19.5 against `SECURITY-REVIEW-EPIC-19.md`. The founder ratified D-S1–D-S10 at their defaults on 2026-11-21, and Architect pass 2 is done.

## Stories

- Story 19.1: The signup door opens safely on staging
- Story 19.2: A stranger creates an account
- Story 19.3: A verified account creates its organization
- Story 19.4: The onboarding wizard guides setup and pre-fills nothing
- Story 19.5: Abandoned signups are cleaned up and the operator keeps control

## Requirements & Constraints

- **Verification first.** The email is verified before any organization exists. One account founds at most one organization.
- **No enumeration (Q28).** Signup, resend, recovery, email sign-in and organization creation never reveal whether an address, account or organization exists. They give the same status, body, headers and timing class. Slugs are not secret, but no surface lists them or answers an anonymous caller.
- **Isolation (Q29).** A self-provisioned organization passes the full `test/rls-isolation.test.ts` suite. An authenticated account with no `members` row reads nothing and writes nothing, across every table, RPC, Storage path and Edge Function.
- **Abuse limits (Q30).** Limits apply per address and per network. A global ceiling caps organizations created per day (default 20, an operator setting) and refuses with a neutral "try later". There is no captcha and no disposable-address blocklist.
- **Nothing pre-filled.** A new organization holds only the annual-leave absence type. No pilot or fire-department literal (`Dan`/`Noć`, four teams, 12 hours) may appear in the `signup` or `onboarding` copy.
- **Housekeeping.** Unconfirmed accounts are deleted after 7 days. Confirmed accounts with no organization are deleted after 30 days. An account with a `members` row is never deleted. Only the operator can suspend or unsuspend an organization.
- **Repository and docs.** The repository is public. Docs never contain hosts, CIDRs, keys or tokens. All copy is Croatian and lives in `hr.json`. Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes.

## Technical Decisions

- **Three switches open the door (AD-21).** All three are shut by default:
  - GoTrue's environment: `SHIFT_DISABLE_SIGNUP` and `SHIFT_MAILER_AUTOCONFIRM` both default to `true`. Staging sets them to `false`. `production.env.example` keeps them `true`.
  - The database: the singleton `private.signup_settings` (`open`, `accounts_per_day` 100, `organizations_per_day` 20, `attempts_per_account` 10). No session holds any privilege on it, and closing it is the circuit breaker.
  - The SPA: `VITE_SIGNUP_ENABLED`, which only changes what is shown. `require-config.mjs` refuses it for production.
- **The auth entrypoint refuses a half-built door.** The wrapper accepts only the exact booleans `true` and `false`. With signup open, it also requires all of these: autoconfirm off, SMTP set, the before-user-created hook on, `GOTRUE_RATE_LIMIT_HEADER`, OTP expiry of 3600 or less, OTP length 10, and template URLs that serve `token_hash`. Its test runs it under `sh`.
- **The before-user-created hook (AD-21).** `public.before_user_created_hook` is a definer that only `supabase_auth_admin` may execute, and it writes nothing. It gives one refusal, `SIGNUP_REFUSED`, for each of these: the door is closed, the address is synthesized or malformed, the local part would fail `members_username_check`, or the 24-hour accounts ceiling is reached. It does not run for `POST /admin/users`, so `admin-auth` is unaffected.
- **Kong is the anti-enumeration boundary (AD-22).** The SPA is not.
  - `/auth/v1/` is an allow-list, so every other path and every path variant answers 404.
  - `signup`, `recover` and `resend` answer `200 {}` at once, then relay to GoTrue from a timer. Synthesized and malformed addresses are not relayed. If Kong's sandbox cannot relay, use the header/body-filter fallback, which leaves the timing to founder decision F1.
  - `POST /verify` passes only `{token_hash, type}`, and a `GET` on it is 404. `PUT /user` with `email` or `phone` answers 422.
  - `KONG_HEADERS=off`.
  - Kong's `rate-limiting` (`limit_by: ip`, `policy: local`) sits on the mail routes, `/token`, `/verify` and `rpc/create_organization`. Traefik labels are never used for this.
  - Trusted proxy: `KONG_TRUSTED_IPS` is set from `SHIFT_PROXY_CIDR`, never `0.0.0.0/0`. GoTrue gets `GOTRUE_RATE_LIMIT_HEADER=X-Real-IP`.
- **Two identity kinds (AD-12).**
  - **The predicate.** An account is a username identity exactly when its address is synthesized (`shift.invalid` or a subdomain of it). Every other account is an email identity. No column stores the kind.
  - **Three homes, one vector file.** The predicate lives in `isSynthesizedAddress` (SPA), `private.is_synthesized_address` (SQL) and Kong's rendered Lua. All three run `test/fixtures/synthesized-addresses.json`.
  - **Sign-in.** An entry containing `@` is an email sign-in with no slug. Any other entry is a username plus the slug.
  - **The Founding Admin's username** is the trimmed address's local part, lower-cased ASCII-only (`translate` over A–Z, as 0066's hook derives it; deferred-work, OWNER 19.3), not `lower()`. The trigger `members_username_follows_email_identity` (23514 `SIGN_IN_IS_EMAIL`) holds it to the address.
  - **Recovery** goes through `/recover` and is for email identities only.
  - **Email links** are `/potvrda?token_hash=…&type=…`, verified by `verifyOtp` only when the user clicks.
- **`admin-auth` (AD-16).** `updateUserById` maps the trigger's refusal to 409 `SIGN_IN_IS_EMAIL` and makes no auth call. `resetPassword` never sends `email`. `clearMustSetPassword` is harmless for an account with no claim. No new Edge Function is added, so the count stays four.
- **`create_organization` (AD-23)** is a SQL `SECURITY DEFINER` with `search_path = ''`, executable by `authenticated` only. It takes no organization id, member id or address. Its steps, in order:
  1. Lock the caller's `auth.users` row.
  2. Refuse with `ORGANIZATION_NOT_CREATABLE` unless the caller is confirmed, not banned or deleted, an email identity, without `must_set_password`, and without a `members` row.
  3. Validate the input, including `private.is_known_timezone`.
  4. Take an advisory lock.
  5. Write a `private.organization_attempts` row and apply the limits. A limit is returned as `TRY_LATER`, never raised.
  6. Answer a taken or reserved slug with `SLUG_UNAVAILABLE` plus a proposal (`-2`…`-9`, else 4 random characters). Reserved slugs are a check constraint.
  7. Insert the organization (`founded_by` unique, no foreign key) and the Founding Admin in one transaction.
  8. Answer `ORGANIZATION_CREATED`. The SPA then calls `refreshSession()`.
- **AD-10, accounts with no claim.** An account with no `members` row has no claim, and the hook is unchanged. 19.1's sweep enumerates every table and function from the catalog rather than from a list.
- **AD-10, suspension.** `organizations.suspended` is read only through `private.organization_live`, and a pin enforces that. Its callers are:
  - `current_member_access`;
  - the token hook (`SIGN_IN_REFUSED`);
  - `calendar_feed_inputs` (404);
  - the reminder and notify paths, which write or send nothing. Queued rows settle `ORGANIZATION_SUSPENDED`.
- **Onboarding (AD-24).**
  - `sessionDestination` in `features/auth/services` is the one router that every guard uses.
  - Progress is derived from rows by one hook, `use-onboarding-progress.ts`, reading each surface's own query keys. Only `organizations.onboarding_dismissed` is stored.
  - Each wizard step composes the shipped feature's components and hooks. No second write path exists.
  - "Invitation" means the shipped credential hand-off. No email invitation is built (founder decision F2).
- **Housekeeping (AD-25).** pg_cron `housekeeping` runs daily at 03:15 UTC and calls `private.delete_abandoned_accounts()`, which no session role can execute. It uses `for update skip locked`, then checks again that no `members` row exists. It also purges attempts older than 30 days. Its operator scripts live in `supabase/operator/`: `suspend-`/`unsuspend-organization.sql` and `signup-report.sql`.
- **Secrets (AD-17).**
  - GoTrue sends over SMTP through Resend with its own sending-only key, `GOTRUE_SMTP_PASS`. That key lives only in the Coolify auth environment. The compose names it as `${GOTRUE_SMTP_PASS:-}`.
  - Croatian templates are built from `hr.json`'s `signup.email` keys into `dist/auth-email/*.html`.
  - `config.toml` pins the local and staging auth values. Production's closed door lives in `production.env.example`.
- **Audit (AD-11).** The new `organizations` columns are audited:
  - `founded_by` is hidden.
  - `suspended` and `onboarding_dismissed` are boolean fields.
  - Operator writes have a null actor.
  - `signup_settings` and `organization_attempts` are excluded from the audit and named as such in `test/supabase-scaffold.test.ts`.

## UX & Interaction Patterns

- **Signup (UX-DR60).** `/registracija` takes email and password. It notes that this creates a new organization rather than joining one, and links to *Prijava*. Every submit leads to one neutral screen (`Ako adresa može primiti poruku, poslali smo poveznicu za potvrdu.`), and resend is throttled. The SPA checks the address shape and the 10-character password floor before sending, and it never reads the mail routes' bodies. *Prijava* accepts an email address and offers `Nova organizacija? Registriraj se`.
- **Create organization (UX-DR61, step 1).** `/postavljanje` step 1 takes:
  - name;
  - slug, proposed from the name and editable;
  - a free Organization Type label;
  - timezone, proposed from the browser and confirmed by the user;
  - locale, read-only;
  - Leave Year start, required, with nothing selected;
  - the Founding Admin's name and allowance, required and empty.
- **Wizard (UX-DR61, steps 2–7).** The steps show a rail (`korak 3 od 7`) and *Preskoči za sada*. While setup is unfinished and not dismissed, an active admin of a signup-founded organization sees a *Danas* card, `Postavljanje: još N koraka`. The card sits outside the *Danas* freshness keys and never holds the skeleton. Empty states use examples that fit any organization.
- **UX review.** Story 19.4 needs a UX review with mockups (phone and desktop) before its spec freezes.

## Cross-Story Dependencies

- **Story order.** 19.1 → 19.2 → 19.3, and both 19.4 and 19.5 follow 19.3.
- **Staging.** 19.1 is ready to build, but applying it on staging waits for 20.5. The Kong and GoTrue work builds on 20.1's compose (`deploy/coolify/supabase/`) and on `test/self-hosted-stack.test.ts`.
- **Probes.** 19.1's rehearsal must prove that Kong's sandbox can relay from a timer, or else founder decision F1 opens. 19.2's enumeration probe runs on 20.1's rehearsal stack (DEPLOY.md §9.5), then on staging, and never on the CLI's Kong.
- **Before production.** These must be recorded first:
  - founder decision F1 (the mail routes' timing, if Kong cannot relay);
  - founder decision F2 (confirming that "invitation" means the shipped credential hand-off);
  - review row A10 (the accepted denial of service);
  - review row B8 (the password-timing residual);
  - the second-factor decision for email identities.
- **Ties to other features.** 19.5 extends AD-14's feed, reminder and notify paths from epics 16 and 17 for suspension. The wizard reuses the shipped hour-band, team, shift-type, rotation and member surfaces.
