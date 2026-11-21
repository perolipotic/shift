# Epic 16 Context: My shifts are in my phone's calendar, and the month prints

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A member subscribes Google or Apple Calendar to their own at-work shifts through a personal, revocable feed link. Their calendar then follows rota changes within the day, with no second implementation of the schedule anywhere. Anyone who reads the schedule can also print the month. Print (16.1) has shipped (#335). The feed rests on the canonical domain package running server-side (16.2), then a hashed bearer token (16.3), the public `calendar-feed` function (16.4) and the member's subscription screen (16.5). Architect pass 1 is done, and the founder ratified D-S1 to D-S10 at their defaults on 2026-11-21, so each story now waits only on the one before it. A `security-review` of 16.3–16.4 comes before production.

## Stories

- Story 16.1: The month prints (done, #335)
- Story 16.2: The domain package runs on the server
- Story 16.3: A member's feed token is a revocable secret
- Story 16.4: The calendar feed serves a member's own shifts
- Story 16.5: A member subscribes from *Kalendar na mobitelu*

## Requirements & Constraints

- **One canonical implementation.** Server projection runs the same `@shift/domain` as the browser. It is never re-derived in SQL or in a function. The function loads with no runtime dependency.
- **No new paid service or third-party provider.** The ICS subset is hand-written, and there is no new runtime dependency.
- **Parity proven for both fixtures.** The server's inputs equal what the browser's reads yield. The Deno projection, the hours and the at-work selection equal the browser's for every member and date of the tested window.
- **Feed contents (D-S2).** The feed holds only the member's own at-work shifts. SUMMARY is the shift type name plus the team name. It has no leave, absence type (it can be health data), other member, hours, address or note. The window is today − 31 through today + 182, inclusive, and a shift belongs to it by its start date.
- **At-work selection (R12).**
  - R12.1: the member's working scheduled shifts after overrides and loans, minus any date with a full-day leave record of any type.
  - R12.2: a half day keeps the shift with the worked half's interval.
  - R12.3: the feed, the reminders and the `.ics` download read R12 only.
- **Token (D-S1).**
  - 256 random bits, returned once, stored only as a SHA-256 hash, at most one live token per member, no expiry.
  - The member can regenerate it or turn it off, and the old token dies at once. An admin can revoke it but never sees the URL or the token.
  - It is never logged in full, and it is served over HTTPS only.
  - The change history records create and revoke, with no token or hash material.
- **Anti-enumeration (D-S8).** A malformed, unknown, revoked, replaced or deactivated token gets one identical 404: the same status, body and headers (`Cache-Control: no-store`), the same timing class, and no write.
- **Copy.** It lives in the `feed` namespace of `hr.json`. The DESIGN.md, EXPERIENCE.md and UX-DR lines each story changes are updated in the same change.

## Technical Decisions

- **AD-1, the scope note.** Derivation may run in `calendar-feed` and `remind`. Nothing derived is persisted for it: not in a table, a cache, or a worker's memory across requests. `calendar-feed` writes only `calendar_feed_tokens.last_fetched_at`.
- **AD-7, the package under Deno.**
  - Functions consume the tsc-built `dist` through the bare specifier `@shift/domain`, mapped in each function's own `deno.json` `imports` to `"../../../packages/domain/dist/index.js"`. Never `src/`, a committed copy, or `npm:`/`jsr:`. Every function uses the same target, and `@shift/ics` is mapped the same way.
  - 16.2 confirmed the map on the pinned edge-runtime (bundle and serve from the eszip, via the runtime-parity entry `deploy/parity/`); `supabase functions serve` over it is confirmed by 16.4, whose e2e serves `calendar-feed`.
  - `deploy/functions/Dockerfile` copies both packages' `dist` and bundles them into each eszip (from 16.4, the first function that imports them).
  - `FUNCTIONS_SOURCES` in `scripts/ci/deploy-images.sh` must hash (the domain's since 16.2, `@shift/ics`'s from 16.4) both packages' tracked sources, `package.json`, `tsconfig*.json`, `tsconfig.base.json` and `pnpm-lock.yaml`, and never `dist`. `test/coolify-deploy.test.ts` asserts it (16.2).
  - 16.2 adds R12 as one named domain function.
- **AP1 Deno spike (2026-11-21).** It ran with no container started: `docker image save` of edge-runtime v1.74.3 (Deno 2.1.4, no separate `deno` binary), under chroot, in a loopback-only network namespace.
  - `src/` fails, because the `.js` specifiers do not resolve to `.ts`.
  - The tsc `dist` bundles and serves.
  - An import map onto `dist/index.js` bundles to a 200 kB eszip and serves.
  - The output was byte-identical to Node 22: both fixtures' month schedules, a loan month and the hour bands.
  - The runtime's `Intl` has full zone data (Europe/Zagreb DST verified).
- **AD-6, zone arithmetic at the edges.** All rules stay nominal wall-clock minutes. `packages/domain/src/zone.ts` is the only module that converts a local date and minute to an instant, lists offset transitions, or names `Intl` or `Date`. It uses built-in `Intl` only, and the purity test asserts that. A second local-to-UTC conversion anywhere is a defect.
- **AD-19, one assembly.**
  - `private.member_schedule_inputs(p_member, p_from, p_to)` is `SECURITY DEFINER` and executable by no role. Only `calendar_feed_inputs` and `reminder_inputs` call it.
  - It returns one `jsonb` in the domain's camelCase input shapes, as one exported type, `ScheduleInputs` (the story may rename it):
    - the organization id and zone;
    - the teams;
    - the shift types with their versions;
    - the rotation steps, and the assignments with their creation stamps;
    - every member's membership, status versions and live loans, with no names;
    - the live shift-type and roster overrides in the window, with `writtenAt` in µs and no reason or author;
    - the one member's own leave records overlapping the window, with no type name or reason.
  - Versioned rules come whole. The SQL writes µs as `(extract(epoch from t)*1000000)::bigint`. "Live" is one shared SQL helper, never restated.
  - A function validates the assembly with the domain's own preconditions (`checkLoans`, …) and maps no rows of its own.
  - Read parity is a DB suite that runs in CI only. It compares the browser's path (the calendar snapshot plus own leave, through `apps/web`'s one adapter, `scheduleInputsOfCalendar(snapshot, ownLeave, window)`) with `member_schedule_inputs`. They must be deep-equal, stamps included, and so must the R12 each projects.
  - Runtime parity is a Node Vitest that writes R12, the month schedule, the hours, the `zone.ts` conversions and the SHA-256 of the token vector to one JSON. A CI job compares it byte for byte with the same probe run from `dist` under the pinned edge-runtime, `--network none`, with the image pin asserted equal to the Dockerfile's.
  - A new rule kind is added to the browser read, the assembly and the parity fixture in the same story.
- **AD-14, four Edge Functions.** The functions are `admin-auth`, `notify`, `calendar-feed` and `remind`. Each new function is a `[functions.*]` table in `config.toml` and a router `FUNCTIONS` entry, held equal by `test/functions-router.test.ts`.
  - **The route.** `calendar-feed` has `verify_jwt = false` and serves `GET` and `HEAD /functions/v1/calendar-feed/<token>.ics`. Any other method is 405.
  - **The token.** It is 32 bytes from `gen_random_bytes`, written as unpadded base64url (43 characters, via `rtrim(translate(encode(b,'base64'),'+/','-_'),'=')`). It is stored as `sha256(convert_to(token,'UTF8'))`, a unique `bytea`. One pinned test vector is shared by the SQL suite and the function tests.
  - **The hash is a credential.** `token_hash` has no column privilege for any role, and no RPC, view or audit row returns it. The audit trigger stores `to_jsonb(row) - 'token_hash'` and ignores an update that changes only `last_fetched_at`. The state reads return `{ live, created_at, last_fetched_at }` only.
  - **The lookup.** The function checks the canonical path regex, hashes with WebCrypto, and POSTs 64 lowercase hex characters to `public.calendar_feed_inputs(p_token_hash text)`. That RPC is `VOLATILE` and anon-executable. On a hit it sets `last_fetched_at` at most every 15 minutes, takes the window from `organization_today`, and returns `{ window, inputs }`.
  - **Deactivation.** The lookup's "active in the organization's today" rule ends a feed. An inactive version already in effect when it is inserted revokes the live token in the same transaction, and a reactivation revokes any token still live.
  - **A hit** answers 200 `text/calendar; charset=utf-8`, `Cache-Control: private, max-age=900`.
  - **Logging.** The function logs fixed codes only, never its path. Kong's access log already redacts the path. 16.4 sets `KONG_LOG_LEVEL=crit`, and Traefik's access log stays off.
  - **The image probe.** It must see the 404 for an unknown token.
- **AD-17.** `calendar-feed` holds only `SUPABASE_URL` and `SHIFT_PUBLISHABLE_KEY`, never the secret key. `test/key-hygiene.test.ts` asserts it.
- **AD-20, `@shift/ics`.**
  - It is a pure package with zero dependencies that may import `@shift/domain` only. It writes CRLF, 75-octet folding and TEXT escaping, and is checked against golden files covering both DST transitions and a midnight-crossing shift.
  - Calendar properties: `METHOD:PUBLISH`, `X-WR-TIMEZONE`, and a fixed `NAME`/`X-WR-CALNAME`.
  - One `VTIMEZONE` built from `zone.ts`: explicit observances with no `RRULE`, from the last transition before the window through the last one inside it.
  - One VEVENT per R12 shift. `UID` is `<date>-<teamId>-<memberId>@shift` (`@shift-download` for the month download). `DTSTART` and `DTEND` carry a `TZID` in local time, never UTC-only or floating. `DTSTAMP` is the request instant. There is no DESCRIPTION, LOCATION, ATTENDEE or ORGANIZER.
  - Outlook rendering is checked once by hand, or recorded as an accepted risk.

## UX & Interaction Patterns

- **The subscription screen (UX-DR54)** is *Više → Kalendar na mobitelu*. With no feed it shows *Izradi poveznicu* and one sentence. With a feed it shows:
  - the URL, masked by default, with *Kopiraj*;
  - *Dodaj u Google kalendar* and *Dodaj u Apple kalendar* (`webcal://`);
  - `zadnje preuzimanje {datum vrijeme}` or `još nije preuzeto`;
  - *Izradi novu poveznicu*, with a warning that the old link dies;
  - *Isključi*;
  - a fixed note on Google's refresh lag, and a note on what the feed omits (leave, other people).
- **Month download.** A month can be downloaded as `.ics` from the same serializer.
- **The admin's member detail (UX-DR55)** shows `Kalendar na mobitelu: uključen / isključen` and *Isključi poveznicu*, never the URL.

## Cross-Story Dependencies

- 16.2 → 16.3 → 16.4 → 16.5, strictly in sequence.
- **Inputs from `deferred-work.md`.**
  - 16.2 must answer the 18.2 deferral: `member_schedule_inputs` returns live loans exactly as `calendar_team_loans()` does, proven by parity.
  - 16.4 must close the 20.2/20.5 entry on the Kong error log and the Traefik access log.
- **Epic 17 (`remind`, `reminder_inputs`)** reuses 16.2's assembly, R12, `zone.ts` and the runtime-parity job. Epic 18's loans must flow through both the browser read and the assembly.
- **Test limits.** DB tests (read parity) and the CI runtime-parity job are verified in CI only, never against the shared local stack.
