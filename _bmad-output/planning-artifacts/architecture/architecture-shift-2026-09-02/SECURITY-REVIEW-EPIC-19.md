# Security review checklist: Epic 19 (self-service signup)

- **Status:** checklist, written by Architect pass 2 (AP2) on 2026-11-21. It is not a review result.
- **Used by:** the `security-review` of 19.1–19.5 that D-S5 requires before production opens (ratified 2026-11-21), and each 19.x story's code review for its own rows.
- **Governing ADs:** AD-10, AD-11, AD-12, AD-16, AD-17 and AD-21–AD-25 in `ARCHITECTURE-SPINE.md`.
- **This repository is public.** The review records findings and evidence. It never records host addresses, CIDRs, keys or tokens.

Each row needs evidence: a test that runs in CI, a probe run on the local stack or on staging, or a file and line. "Looks right" is not evidence.

## A. The door (AD-21)

| # | Check | Evidence |
|---|---|---|
| A1 | The compose defaults `SHIFT_DISABLE_SIGNUP` and `SHIFT_MAILER_AUTOCONFIRM` to `true`. `production.env.example` keeps both `true`. The parity test fails otherwise | test |
| A2 | The auth entrypoint refuses any boolean that is not exactly `true` or `false`. The test tries `0`, `f` and `False`. With signup on, it refuses to start unless all of these hold: autoconfirm off, SMTP set, the before-user-created hook on, `GOTRUE_RATE_LIMIT_HEADER` set, `OTP_EXP` of 3600 or less, `OTP_LENGTH` 10, and each template URL serving `token_hash` | test (runs the wrapper) |
| A3 | `private.signup_settings.open` defaults to false. No session role holds any privilege on the table | catalog test |
| A4 | `require-config.mjs` refuses `VITE_SIGNUP_ENABLED=true` for production | test |
| A5 | The hook refuses a synthesized address, an address whose local part fails the username check, a closed door and the accounts ceiling, all with one message. It writes nothing. Its execute grant is `supabase_auth_admin` only | DB test, catalog |
| A6 | `POST /admin/users` (admin-auth's `createUser`) still works with the hook on, so the hook does not run there | local-stack probe |
| A7 | Kong's `rate-limiting` is on the four routes, with the staging values, `limit_by: ip` and `hide_client_headers`, and it answers 429 when exceeded. No Traefik label middleware exists (Coolify would chain it onto every route) | Kong render test, rehearsal probe |
| A8 | GoTrue's per-IP limit and its audit log see the client address, not the proxy. `KONG_TRUSTED_IPS` is the proxy network only, never `0.0.0.0/0` or `::/0`. A client-sent `X-Real-IP` and a spoofed `X-Forwarded-For` are not trusted | staging probe |
| A9 | `GOTRUE_RATE_LIMIT_EMAIL_SENT` and `SMTP_MAX_FREQUENCY` are set explicitly. The budget fits Resend's plan together with `notify`'s volume | config, figures |
| A10 | **An accepted denial of service is decided.** One actor can exhaust `accounts_per_day`, the stack-wide email budget or the organization ceiling, and that shuts signup or recovery for everyone. IPv6 rotation inside one /64 escapes per-address limits. Record the production values, the alert (`signup-report.sql`), and whether the host serves AAAA | founder decision at D-S5 |

## B. Anti-enumeration (AD-22)

| # | Check | Evidence |
|---|---|---|
| B1 | Through Kong, signup, recover and resend each answer `200 {}` with identical header names and values for four addresses: new, known confirmed, known unconfirmed and synthesized. `KONG_HEADERS=off`: no `Via`, `Server` or `X-Kong-*` header | probe on 20.1's rehearsal stack, then staging (19.2) |
| B2 | The timing class is uniform for the same four. Kong answers first and relays in the background. If that cannot be proven, founder decision F1 is recorded | probe |
| B3 | A synthesized, malformed or unreadable body never reaches GoTrue on the three routes | probe and Kong render test |
| B4 | Kong's `/auth/v1/` is an allow-list. `otp`, `magiclink`, `reauthenticate`, `invite`, `authorize`, `callback`, `factors`, `sso`, a GET on `verify`, and path variants (trailing or doubled `/`, `;`, percent-encoding) all answer 404 | probe |
| B4a | `POST /auth/v1/verify` passes only `{token_hash, type}`. An email-plus-code body is refused before GoTrue. OTP expiry is 3600 or less, and its length is 10 | probe, config |
| B4b | `PUT /auth/v1/user` with `email` or `phone` is refused by Kong. A password change still works | probe |
| B5 | A password grant gives `invalid_credentials` for an unknown address and for a wrong password alike | probe |
| B6 | `create_organization` answers `SLUG_UNAVAILABLE` for a taken slug and for a reserved slug with the same shape. It is limited per account and per IP | DB test |
| B7 | No anonymous read path lists or confirms organizations or slugs. `has_function_privilege('anon', …)` lists nothing new | catalog test |
| B8 | **Accepted residual:** a password grant for a known address takes a bcrypt comparison that an unknown one does not. Measure it on staging and record whether the founder accepts it | probe, founder |
| B9 | A masked GoTrue failure is still visible: Kong logs the upstream status as a fixed code without the address | log check |

## C. Identity (AD-12, AD-16)

| # | Check | Evidence |
|---|---|---|
| C1 | The three homes of the synthesized-address predicate (SPA, SQL, Kong's rendered Lua) agree on `test/fixtures/synthesized-addresses.json`: mixed case, a subdomain, a trailing dot, look-alikes (`shift.invalid.example`, `xshift.invalid`), and malformed addresses (two `@`, quotes) | test |
| C2 | Renaming an email identity is refused by `members_username_follows_email_identity` (23514 `SIGN_IN_IS_EMAIL`), through `admin-auth` (409, no auth call) and through a direct PATCH alike | DB test, function test |
| C3 | `resetPassword` never sends `email`. A reset Founding Admin must set a password at the next sign-in | function test |
| C4 | Username sign-in for every existing account is unchanged with signup on | e2e and probe |
| C5 | No session can change its sign-in address (B4b), so neither kind can become the other | probe |
| C6 | Email links use `token_hash` and are verified by POST, on a click. No session token appears in a URL. Opening a link with a GET, or loading `/potvrda`, consumes nothing | probe |
| C7 | The allow list and the site URL are the app origin only. A link cannot redirect anywhere else | config |

## D. Creating an organization (AD-23)

| # | Check | Evidence |
|---|---|---|
| D1 | The function takes no organization id, member id or address. Execute is `authenticated` only | catalog |
| D2 | It is refused for an unconfirmed account, for a username identity, for an account with `must_set_password`, and for an account that already has a member row in any organization | DB test |
| D3 | Two concurrent calls from one account create one organization. `founded_by` is unique | DB test |
| D4 | The 24-hour ceiling and the per-account attempts limit hold under concurrency. A limit commits its attempt row | DB test |
| D5 | The new organization holds no team, shift type, pattern, hour band or setting beyond FR-74's annual leave. Its row set equals an operator-provisioned organization's | DB test |
| D6 | A self-provisioned fixture organization passes all of `test/rls-isolation.test.ts`, in both directions against the pilot fixture | DB suite |
| D7 | `search_path = ''` and every name is qualified. No dynamic SQL | source pin |

## E. An account with no organization, and suspension (AD-10)

| # | Check | Evidence |
|---|---|---|
| E1 | A confirmed account with no claim reads zero rows from every table and view, is refused on every write, gets nothing from every executable function except `create_organization`, cannot write to Storage, and gets nothing from the four functions. The suite is enumerated from the catalog | DB suite (19.1) |
| E2 | `clearMustSetPassword` from such an account changes nothing but its own flag | function test |
| E3 | A suspended organization: its existing tokens read nothing at once, a new sign-in or refresh is refused, the feed answers 404, no reminder or notification is written or sent, and queued rows settle `ORGANIZATION_SUSPENDED`. The catalog sweep runs as a suspended admin. Only `private.organization_live` names `suspended` | DB test, source pin |
| E4 | No session can write `organizations.suspended`, `founded_by` or `signup_settings` | catalog test |

## F. Housekeeping and the operator (AD-25)

| # | Check | Evidence |
|---|---|---|
| F1 | The job deletes only accounts with no member row that are past 7 days (unconfirmed) or 30 days (confirmed) | DB test |
| F2 | An account that is inside `create_organization` is skipped and never deleted (`skip locked`, then the re-check) | DB test |
| F3 | No session role can execute the job's function | catalog |
| F4 | The operator scripts work only over the tailnet and change only `suspended` | runbook |

## G. Secrets and logs (AD-17, NFR-27)

| # | Check | Evidence |
|---|---|---|
| G1 | GoTrue's SMTP key is its own sending-only, domain-restricted Resend key per stack, held only in the auth resource's Coolify environment | runbook, key-hygiene test |
| G2 | No email address, password or `token_hash` is written to Kong's, Traefik's, GoTrue's or the SPA's logs beyond GoTrue's own audit table | staging log search |
| G3 | The SPA bundle check still passes. No new key is in the bundle | CI |

## H. Production opening (D-S5): every box, then the founder's go

1. A through G are reviewed, each with evidence, and nothing is open at high severity.
2. The limits are verified on the production stack's own configuration: the production values of the Kong limits, the GoTrue limits and `signup_settings`.
3. The Resend plan's volume has been checked against the D-S3 ceiling plus `notify` (D-S4's cost risk).
4. Backups (20.7) and monitoring (20.8) run on production.
5. The decision on a second factor for email identities is recorded (spine, Deferred). F1 (timing, if Kong cannot relay) and A10 (accepted denial of service) are decided.
5a. Production restores only from production dumps; a staging dump would carry `signup_settings.open = true`.
6. **The founder says go.** Then, in this order: a reviewed PR lets production build with `VITE_SIGNUP_ENABLED`; the operator sets the production GoTrue environment and restarts auth; then the operator opens `signup_settings` by SQL. Closing again is the reverse order. `signup_settings.open = false` alone stops new accounts and organizations at once.
