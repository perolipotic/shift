---
title: 'Source structure A2a — App.tsx holds the providers, main.tsx only boots'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: '621c7896d77cc7456d1ac959c9e66a94bd4e5574'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The approved proposal (§4.1, Δ6) calls for `App.tsx` to hold the providers, with `main.tsx` doing only the boot. `deferred-work.md` records this as part of "Source structure A2". Today `main.tsx` does everything: it looks up the root element, creates the query client, runs the localization gate, and nests `StrictMode` > `I18nextProvider` > `QueryClientProvider` > `RouterProvider`.

**Approach:** Add `apps/web/src/App.tsx`, which exports `App({ queryClient })` and renders `I18nextProvider` > `QueryClientProvider client={queryClient}` > `RouterProvider router={router}`. The comment explaining why the cache sits inside the localization provider and outside the router moves with it. `main.tsx` keeps the root lookup, `new QueryClient()`, the `if (await bootLocalization(initLocalization))` gate and `createRoot(...).render(<StrictMode><App queryClient={queryClient} /></StrictMode>)`. Behaviour is identical.

## Boundaries & Constraints

**Always:**
- Exactly one `new QueryClient(`, in `main.tsx`, before `createRoot(` and inside the boot gate. The `'@/index.css'` import stays in `main.tsx`.
- `App.tsx` builds no client. It only receives one.
- Every guard that reads `main.tsx` keeps its meaning. Each assertion reads the file that now holds its text:
  - **`features/organization/services/snapshot.test.ts`**:
    - query-client creation and the gate: `main.tsx`;
    - `<QueryClientProvider client={queryClient}>` and the router inside it: `App.tsx`;
    - the non-vacuity floor: per file.
  - **`test/localization-applied.test.ts`**:
    - the boot gate and the imports from `@/lib/i18n` and `@/lib/i18n/boot`: whichever file holds each;
    - `SOURCES` gains `App.tsx`.
  - **`pages/prijava.test.ts`** and **`lib/i18n/boot.test.ts`**: the same treatment for anything that names `main.tsx`.
- Add one assertion that `App.tsx` contains no `new QueryClient(` and no `createRoot(`. Add one that `main.tsx` contains no `<QueryClientProvider` and no `<RouterProvider`.

**Ask First:**
- A guard whose assertion would have to change meaning.
- Any runtime difference.

**Never:**
- No barrels and no lint rule (that is A2b).
- No change to `router.ts` or any page.

</frozen-after-approval>

## Code Map

- `apps/web/src/main.tsx` -- today: imports; `rootElement` with `ROOT_ELEMENT_MISSING`; `new QueryClient()`; the gate, then `createRoot(rootElement).render(<StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></I18nextProvider></StrictMode>)`.
- `apps/web/src/features/organization/services/snapshot.test.ts:70` -- `ENTRY = join(srcRoot, 'main.tsx')`. Uses: 1076 (the client and the provider nesting), 1091 (the gate and the order), 1109 (non-vacuity).
- `test/localization-applied.test.ts:333` -- `main.tsx` in `SOURCES`. 818–834 read `main.tsx` for the boot gate and its imports.
- `apps/web/src/pages/prijava.test.ts`, `apps/web/src/lib/i18n/boot.test.ts` -- grep for `main.tsx` or `main'` and retarget as needed.
- Mentions in comments only (keep them accurate): `lib/i18n/boot.ts`, `lib/i18n/index.ts`, `features/auth/services/address.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/App.tsx` and `apps/web/src/main.tsx` -- split as described in Approach.
- [x] The guard files -- retarget each assertion to the file that holds its text, and add the two cross-checks.
- [x] Comments that describe the entry -- update them.

**Acceptance Criteria:**
- Given the split, when `main.tsx` is read, then it holds the client, the gate and `createRoot`, and no provider. When `App.tsx` is read, then it holds the providers and no client.
- Given each retargeted guard, when a planted mutation breaks its target, then it fails. Check at least these, and revert each afterwards:
  - the router moved outside the query provider in `App.tsx`;
  - `new QueryClient()` moved into `App.tsx`;
  - the gate removed from `main.tsx`.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test` (after a web build), the web build and `pnpm test:e2e` run, then all pass. Unit counts grow only by added cases, and E2E is 78/78.

## Spec Change Log

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/web build` -- expected: exit 0.
- `pnpm test` -- expected: pass, after a rebuild, with the baseline recorded first.
- `pnpm test:e2e` -- expected: 78/78. Run it with port 5173 free and not in parallel with `pnpm test`.

## Suggested Review Order

- The providers, moved from the entry unchanged, with the client passed in.
  [`App.tsx:1`](../../apps/web/src/App.tsx#L1)

- The entry: the root, the one client, the localization gate, the mount.
  [`main.tsx:1`](../../apps/web/src/main.tsx#L1)

- The guards: provider nesting read from `App.tsx`; client creation and gate read from `main.tsx`; the cross-checks.
  [`snapshot.test.ts:1`](../../apps/web/src/features/organization/services/snapshot.test.ts#L1)
