# `pages/`

TanStack Router route definitions — one file per destination, assembled into the
route tree by `src/router.ts`. `pages/` also holds the few components the ROOT
route and the router compose rather than a path: `not-found.tsx` (an unknown
path), `error.tsx` (a route that failed: Croatian copy from `hr.json`, the cause
to the console, never on screen) and `pending.tsx` (the text-free skeleton every
route shows while a guard is still deciding). Member-role reaches Danas, Kalendar, Sati and
Godišnji; admin adds Raspored, Ljudi, Postavke rotacije and Organizacija. `Sati`
is ONE destination with role-scoped content, not one per role (human decision,
2026-09-04), so there are eight and not nine. The roster is not a destination: it
lives inside team detail.

Every destination nests under `_app.tsx`, a pathless layout that carries the
session guard once for all of them; `/` and both sign-in routes stay outside it.
Every admin-only destination, and every admin screen beneath one, also carries
the ONE shared admin guard, `requireAdmin` from
`features/navigation/services/admin-guard.ts`: a member who types the URL is
forwarded to the first destination. `router.test.ts` derives the admin-only
destinations from the table, drives each guard and pins it by identity. The
guards' readers reject after a time budget (`utils/time-budget.ts`), so a hung
read ends on the guard's fail-closed path; the role is re-read on entering a
route and served from the chrome's cache entry while only the search changes.
Which destinations a role actually SEES is `src/features/navigation/utils/destinations.ts` —
data, so a test can execute it — never a list re-derived in a component.

A route composes feature modules and components. It holds no data fetching of its
own — a surface's snapshot loader lives in `features/<module>/services/` (AD-13).
