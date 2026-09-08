# `routes/`

TanStack Router route definitions — one file per destination, assembled into the
route tree by `src/router.ts`. Member-role reaches Danas, Kalendar, Sati and
Godišnji; admin adds Raspored, Ljudi, Postavke rotacije and Organizacija. `Sati`
is ONE destination with role-scoped content, not one per role (human decision,
2026-09-04), so there are eight and not nine. The roster is not a destination: it
lives inside team detail.

Every destination nests under `_app.tsx`, a pathless layout that carries the
session guard once for all of them; `/` and both sign-in routes stay outside it.
Which destinations a role actually SEES is `src/navigation/destinations.ts` —
data, so a test can execute it — never a list re-derived in a component.

A route composes surfaces and components. It holds no data fetching of its own —
that is `surfaces/`.
