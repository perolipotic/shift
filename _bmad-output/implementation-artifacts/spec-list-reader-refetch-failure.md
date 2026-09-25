---
title: 'A failed list refetch keeps the rows and retries'
type: 'bugfix'
created: '2026-09-25'
status: 'done'
baseline_commit: '4979509a6560547aa6c450dfaa3277615224e44b'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The teams, members and hour-bands list readers hand a transient failure to TanStack Query as resolved `{ ok: false }` data. A failed refetch (for example after a write's `invalidateQueries`) therefore replaces a good cached list. The rows, the bar and edit forms vanish until reload, `retry` never runs, and the "rows kept, message beside them" surface state is reachable only from hand-built test fixtures.

**Approach:** Keep the readers' pure `Outcome` contract. Give each list module one exported query-options factory whose `queryFn` REJECTS on the unavailable code, so TanStack retries once and keeps the previous `data` on a failed refetch. The surface-state functions read `isError` for that case. Every screen reading that key uses the factory. Tests drive real `QueryObserver` results.

## Boundaries & Constraints

**Always:**
- `readTeams`, `readHourBands` and `readMembers` keep their signatures and return codes. Their existing tests stay green unchanged.
- Only the UNAVAILABLE code rejects. `MEMBERS_REFUSED` is a settled answer from the policy. It stays resolved data: not retried, and allowed to replace rows.
- Resolve the Supabase table INSIDE the `queryFn` (the factory takes `() => Table`). Then `SUPABASE_ENVIRONMENT_MISSING` stays a query rejection, as it is today.
- One factory per query key, used by every call site of that key. Two `queryFn`s registered for one key is a known defect in this repo.
- Keep today's `staleTime` and `refetchOnWindowFocus: false` values. Each factory sets `retry: 1, retryDelay: 1000` (human decision 2026-09-25). This bounds how long a write's awaited invalidation, and a first failed load, wait: about 1 s, not TanStack's default ~7 s.
- The loading, paused-offline and message rules stay as they are: `loading` is never true beside a refusal.
- On the two edit screens (`/ljudi/smjene/$id`, `/organizacija/satni-pojasi/$id`), a read failure hides the form and shows only the read message, as it did before this change (human decision 2026-09-25). Otherwise a form remounted after a landed save would show stale values beside "saved", and a second Save would overwrite the change. List screens keep their rows.

**Ask First:** Changing `memberFormRefusalOf`, any i18n string, or the `QueryClient` defaults in `main.tsx`.

**Never:** Touching the roster/own-team readers (`teams/roster.ts`), `readOrganization`, the chrome's role read, or `createFormStateOf`. Using `placeholderData` as the fix.

## I/O & Edge-Case Matrix

| Scenario | Query state | Surface state |
|----------|-------------|---------------|
| First read succeeds | success, data = rows (teams/bands may be `[]`) | rows, no refusal, not loading |
| First read unavailable | one retry exhausted → error, data undefined | rows `null`, refusal UNAVAILABLE |
| Refetch unavailable over good rows | error, previous data kept | previous rows AND refusal UNAVAILABLE |
| Transient failure, then retry succeeds | success after retry | rows, no refusal |
| Members refused (zero rows) | success, data = refused | members `null`, refusal `MEMBERS_REFUSED`, no retry |
| Members refused, then refetch unavailable | error, data = refused | members `null`, refusal `MEMBERS_UNAVAILABLE` (the current fault wins) |
| Offline | pending, fetchStatus `paused` | refusal UNAVAILABLE, not loading |
| Edit screen, read failure over good rows | error, previous data kept | no form, read message only |

</frozen-after-approval>

## Code Map

- `apps/web/src/teams/list.ts` -- `TEAMS_LIST_KEY`, `readTeams`, `TeamsQueryAnswer`/`teamsSurfaceStateOf`. The `!answered.ok` data branch goes away for teams.
- `apps/web/src/hour-bands/list.ts` -- `readHourBands`, `HourBandsQueryAnswer`/`hourBandsSurfaceStateOf`. Same shape as teams. Refresh its doc comment for the `isError` model.
- `apps/web/src/members/list.ts` -- `readMembers`, `MembersQueryAnswer`/`membersSurfaceStateOf`. Its long doc comment describes the old "resolved VALUE" model and must be rewritten.
- `apps/web/src/teams/write.ts` `teamFormStateOf` and `apps/web/src/hour-bands/write.ts` `hourBandFormStateOf` -- the edit screens' form gate. It returns `{ x: null, refusal: null }` when given `null` rows, and the screen then renders only the read message.
- `apps/web/src/members/write.ts` `memberFormRefusalOf` -- read-only. It already hides the form on any list refusal.
- Call sites to switch to the factories: `routes/ljudi.tsx`, `routes/ljudi.$id.tsx` (members and teams), `routes/ljudi.smjene.tsx`, `routes/ljudi.smjene.$id.tsx`, `routes/organizacija.satni-pojasi.tsx`, `routes/organizacija.satni-pojasi.$id.tsx`. The comment right after the query in `routes/ljudi.tsx` says "all four" states. Update it.
- `apps/web/src/main.tsx` -- the comment says `retry` is inert because readers never reject. Narrow it to `readOrganization`. Keep lines wrapped. No code change.
- `apps/web/src/routes/prijava.test.ts` -- source-text assertions on the route files (`readX(` once, `queryKey:`, the cache options in the screen). Retarget them to the factories.
- Tests: `teams/list.test.ts`, `hour-bands/list.test.ts`, `members/list.test.ts` -- replace the hand-built `isError: true` fixtures.
- Under vitest's node env TanStack's `environmentManager` reports "server", which forces `retry` to 0. The tests must flip it with `environmentManager.setIsServer(() => false)` and restore it afterwards.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/teams/list.ts`, `apps/web/src/hour-bands/list.ts` -- add `teamsQueryOptions` / `hourBandsQueryOptions(table: () => Table)` via `queryOptions`: key, `queryFn` (returns rows, or throws `new Error(code)`), `staleTime`, `refetchOnWindowFocus: false`, `retry: 1`, `retryDelay: 1000`. Retype `data` to the rows and simplify the surface-state function.
- [x] `apps/web/src/members/list.ts` -- `membersQueryOptions`, same options. The `queryFn` resolves to a narrow ok-or-refused type, narrowed exhaustively (a new `MembersFailure` code must fail to compile, never be relabelled REFUSED), and throws on `MEMBERS_UNAVAILABLE`. `membersSurfaceStateOf`: `isError` beside refused data → `MEMBERS_UNAVAILABLE`. Rewrite the doc comment.
- [x] `apps/web/src/teams/write.ts`, `apps/web/src/hour-bands/write.ts` -- add a `readFailed: boolean` parameter to `teamFormStateOf` / `hourBandFormStateOf`. When it is true, return the no-form state. Update the two edit screens to pass `readRefusal !== null`. Test it in the modules' `write.test.ts`.
- [x] the seven route call sites -- `useQuery(xQueryOptions(() => supabaseClient().from(X_TABLE)))`. Drop the unused imports. Fix the `ljudi.tsx` and `main.tsx` comments.
- [x] `routes/prijava.test.ts` -- each screen calls its factory, never the reader. The cache options live in the list modules.
- [x] the three `list.test.ts` -- drive each factory through a real `QueryClient` + `QueryObserver` with stubbed tables. Override only `retryDelay: 0`. Cover every matrix row. Assert that the factory's `retry` is 1 and `retryDelay` is 1000. Spy on `console.error` in all three. Include the "never loading beside a refusal" check in all three.

**Acceptance Criteria:**
- Given a list screen showing rows, when a write invalidates the key and the refetch is unavailable, then the rows stay and the unavailable message shows beside them.
- Given `apps/web/src/routes`, when grepping for `readTeams(`, `readMembers(` or `readHourBands(`, then there are no matches.

## Spec Change Log

- **Loop 1 (review, 2026-09-25).**
  - Triggering findings (all three reviewers):
    - With the default `retry: 3`, every write handler that awaits `invalidateQueries` held its busy lock ~7 s after a failed refetch (~14 s on `ljudi.$id`). If the browser went offline between retries, it stayed locked until reconnect.
    - The edge-case hunter: after a landed save plus a failed refetch, the edit form remounted with stale values beside "saved".
  - Amended (human-approved, frozen block):
    - `retry: 1, retryDelay: 1000`.
    - Edit screens hide the form on a read failure.
    - A new matrix row: refused, then unavailable, shows UNAVAILABLE.
  - Patch-level items folded into the tasks:
    - exhaustive members narrowing;
    - stale comments in `ljudi.tsx`, `main.tsx` and the hour-bands doc;
    - consistent `console.error` spies and the loading-beside-refusal checks.
  - Known-bad state avoided: a multi-second disabled Save after a successful write, and a stale edit form inviting an overwrite.
  - KEEP from attempt 1:
    - The factory shape, `queryOptions` and the table resolved inside `queryFn`.
    - The `QueryObserver`-driven tests with call-counting stub tables, and the `environmentManager.setIsServer` flip.
    - The `prijava.test.ts` retargeting.
    - The rewritten doc comments.
    - The reverted attempt is saved at `/private/tmp/claude-501/-Users-perolipotic-Desktop-hobby-shift--claude-worktrees-list-reader-fix/2dac873a-59fb-4f55-898d-d16ee68196c4/scratchpad/attempt-1.patch`. Reuse it as a starting point, then apply the amendments above. Its retry counts (4 and 5 calls) become 2 and 3.

## Design Notes

Why reject rather than `placeholderData`: TanStack already keeps `data` on a failed refetch and runs `retry`, but only for a rejection. `placeholderData` would hide the failure instead of reporting it.

```ts
queryFn: async () => {
  const outcome = await readTeams(table());
  if (!outcome.ok) throw new Error(outcome.code);
  return outcome.teams;
},
```

## Verification

Run with Node 24: `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`.

**Commands:**
- `pnpm --filter @shift/web typecheck` -- expected: no errors
- `pnpm --filter @shift/web test` -- expected: all green
- `pnpm lint` -- expected: clean

## Suggested Review Order

**Reject on unavailable, so TanStack retries and keeps rows**

- Entry point: the queryFn throws only UNAVAILABLE; one retry, one second apart.
  [`list.ts:251`](../../apps/web/src/teams/list.ts#L251)

- Exhaustive narrowing: REFUSED stays data, UNAVAILABLE throws, a new code fails to compile.
  [`members/list.ts:1789`](../../apps/web/src/members/list.ts#L1789)

- Same factory shape for hour bands.
  [`hour-bands/list.ts:374`](../../apps/web/src/hour-bands/list.ts#L374)

**Surface state reads isError, rows kept beside the message**

- Rows from the last good data; isError or paused means UNAVAILABLE.
  [`list.ts:294`](../../apps/web/src/teams/list.ts#L294)

- The current fault beats a cached refusal.
  [`members/list.ts:1883`](../../apps/web/src/members/list.ts#L1883)

- Same for bands.
  [`hour-bands/list.ts:417`](../../apps/web/src/hour-bands/list.ts#L417)

**Edit surfaces never act on a stale read**

- Form gate takes the surface state; a read failure hides the form.
  [`teams/write.ts:308`](../../apps/web/src/teams/write.ts#L308)

- Same for the hour-band edit gate.
  [`hour-bands/write.ts:410`](../../apps/web/src/hour-bands/write.ts#L410)

- Member screen's team picker withheld on a teams read failure.
  [`list.ts:312`](../../apps/web/src/teams/list.ts#L312)

- Wiring on the member edit screen.
  [`ljudi.$id.tsx:273`](../../apps/web/src/routes/ljudi.$id.tsx#L273)

**Call sites use the one definition per key**

- Seven useQuery calls become factory calls; example.
  [`ljudi.tsx:229`](../../apps/web/src/routes/ljudi.tsx#L229)

- Edit screen passes the surface state straight into the gate.
  [`organizacija.satni-pojasi.$id.tsx:105`](../../apps/web/src/routes/organizacija.satni-pojasi.$id.tsx#L105)

- Comment now explains which queries retry and why.
  [`main.tsx:27`](../../apps/web/src/main.tsx#L27)

**Tests**

- Real QueryClient + QueryObserver drive every matrix row.
  [`list.test.ts:227`](../../apps/web/src/teams/list.test.ts#L227)

- Members: refused not retried, refused-then-unavailable shows UNAVAILABLE.
  [`members/list.test.ts:1032`](../../apps/web/src/members/list.test.ts#L1032)

- Hour bands, including the edit gate after a failed refetch.
  [`hour-bands/list.test.ts:288`](../../apps/web/src/hour-bands/list.test.ts#L288)

- Source-text checks: screens call factories, keys named once.
  [`prijava.test.ts:2522`](../../apps/web/src/routes/prijava.test.ts#L2522)
