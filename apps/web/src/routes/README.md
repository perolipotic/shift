# `routes/`

TanStack Router route definitions — one file per destination, assembled into the
route tree by `src/router.ts`. Member-role reaches Danas, Kalendar, Sati and
Godišnji; admin adds Raspored, Ljudi, Postavke rotacije, Organizacija and Sati.
The roster is not a destination: it lives inside team detail.

A route composes surfaces and components. It holds no data fetching of its own —
that is `surfaces/`.
