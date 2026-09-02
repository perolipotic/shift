- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Build the 46-token theme layer, the i18next+ICU localization and formatting layer, and the static Croatian sign-in shell (story 1.1's "speaks Croatian in both themes" half).
  evidence: Story 1.1's full spec measured 3005 tokens against a 1600 ceiling because the story carries four one-time foundations plus a screen. Split at the seam between deployable infrastructure and the themed/translated presentation layer; this half depends on the merged 1-1a workspace but is separately reviewable and testable. Covers UX-DR1, UX-DR2, UX-DR3, UX-DR40 and L1-L7.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: RESOLVED — `supabase db reset` has now been run and passes. No action required.
  evidence: Docker Desktop's outbound networking recovered later in the same session. Verified against the real local stack (CLI 2.116.0, postgres 17.6.1.165): `supabase db reset` exits 0, applies `0001_extensions.sql` and loads `seed.sql`; `select extname, extversion from pg_extension` returns `btree_gist|1.7`; a probe table with `exclude using gist (member_id with =, during with &&)` was created and a second overlapping row refused with `conflicting key value violates exclusion constraint`, so AD-3's leave-overlap constraint is buildable on this extension exactly as planned; and `select count(*) from pg_tables where schemaname='public'` returns 0, confirming the seed creates no schema of its own. The `admin-auth` function was additionally served on the local edge runtime (`supabase-edge-runtime-1.74.3`) and answered `501 NOT_IMPLEMENTED`, `405 METHOD_NOT_ALLOWED`, `400 OPERATION_UNKNOWN` and `400 BODY_NOT_JSON` with the expected bodies.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Revisit typed linting (typescript-eslint) once TypeScript 7.1 ships a stable programmatic API.
  evidence: `typescript@7.0.2`'s only main export is `./lib/version.cjs` — the compiler is the native Go binary and the JS API is available solely under `./unstable/*`. `typescript-eslint@8.69.0` (latest) declares `typescript: ">=4.8.4 <6.1.0"` and needs `ts.createSourceFile`, so neither typed nor syntax-only TS parsing works through it. ESLint 10 has no built-in TS language. `eslint.config.js` therefore parses TS/TSX with `@babel/eslint-parser` + `@babel/preset-typescript` (syntax only, no type information); `tsc` owns type errors. The TypeScript 5.x fallback was explicitly declined by spec 1.1a.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Move `apps/web/src/routes/` to TanStack Router file-based routing once `@tanstack/router-plugin` catches up to the pinned router version.
  evidence: The architecture spine describes `routes/` as "TanStack Router file routes", but `@tanstack/router-plugin` tops out at 1.168.35 while `@tanstack/react-router` is pinned at 1.170.32 — the plugin is not published at the pinned version, and mixing majors of the generator and runtime risks a generated route tree that disagrees with the runtime. 1.1a therefore uses code-based routing (`src/router.ts` assembles `rootRoute.addChildren([...])` from the files in `routes/`), which keeps every route in `routes/` and makes the later switch mechanical.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: The function's `SHIFT_ALLOWED_ORIGINS` allowlist is not the effective CORS policy — the Supabase API gateway overrides it. Decide whether the allowlist stays as defence-in-depth or the gateway config becomes the real control point.
  evidence: Discovered while exercising the function on the local edge runtime, and it changes what the allowlist means rather than whether it works. Kong (the Supabase API gateway, 2.8.1) sits in front of every Edge Function invocation and (a) replaces our `Access-Control-Allow-Origin` with `*`, (b) injects `Access-Control-Allow-Origin: *` even on the replies where our handler deliberately emits no allow header at all, and (c) answers `OPTIONS` itself with `200` and `Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS,TRACE,CONNECT`, so our 204 preflight branch never runs through the gateway. Calling the edge runtime directly (`http://edge_runtime:8081/admin-auth`, bypassing Kong) reaches our handler and returns 501 as designed, which is what confirms the difference is the gateway and not the code. So a browser talking to the deployed function is governed by the gateway's permissive policy; ours is a second, stricter layer that only takes effect if the gateway ever stops overriding it. The handler's own behaviour is fully asserted in `test/admin-auth-boundary.test.ts`. Verify whether hosted Supabase's gateway behaves the same way as the local one before deciding; this sits with the already-deferred CORS/`verify_jwt`-preflight item.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Decide where the caller's JWT is verified, given `verify_jwt = true` in `config.toml` rejects a request before `admin-auth`'s handler runs.
  evidence: A browser CORS preflight carries no `Authorization` header, so with platform-level JWT verification enabled the `OPTIONS` branch and the handler's own `AUTHORIZATION_MISSING` reply can never execute in a deployed environment — the platform answers first, with a body carrying no stable `code`. Story 1.2 must verify the caller against the database anyway (AD-16), which is an argument for `verify_jwt = false` plus in-handler verification. Live local testing confirmed the gateway intercepts `OPTIONS`; confirm hosted behaviour before choosing. Related to the gateway/allowlist entry above.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Add a CI workflow running `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` on push and pull request.
  evidence: No `.github/workflows` or equivalent exists, so every invariant this story added — domain purity, key hygiene, the static-host fallback, the scaffold shape, the privileged boundary's transport — is enforced only when a human types the gate by hand. Two build-output tests additionally skip when `dist` is absent, so the ordering that makes them meaningful (build before test) is currently enforced by prose in DEPLOY.md rather than by a runner.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Add `apps/web/public/_headers` with a Content-Security-Policy and the standard security headers.
  evidence: The application's central invariant is key containment (AD-17), and a CSP restricting `connect-src` to the environment's Supabase origin is the cheapest available reinforcement of it. Nothing currently sets CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors` or HSTS. Cloudflare Pages reads `_headers` from the same directory as the existing `_redirects`, so the mechanism is already in place.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Decide how Cloudflare Pages preview deployments reach `admin-auth`, since their per-commit hostnames are never on the origin allowlist.
  evidence: `SHIFT_ALLOWED_ORIGINS` is set to the staging hostname, but Pages assigns each preview deployment a `<hash>.<project>.pages.dev` host. If Preview is the designated staging front end, the documented staging verification cannot exercise the function from a preview build. Options: use the stable branch-alias hostname, accept a documented suffix pattern, or call the function same-origin.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Decide whether an empty `SHIFT_ALLOWED_ORIGINS` should be a configuration error rather than a silently accepted empty allowlist.
  evidence: `readConfiguration` fails fast on five key and URL problems but accepts a missing allowlist, yielding `allowedOrigins: []`. The result is a function that starts healthy and answers `curl` correctly while being unreachable from every browser — a failure that presents as an opaque network error with no server-side trace. An empty allowlist may be legitimate for server-to-server use, so this is a decision rather than a defect.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Add request hardening to `admin-auth` — a `content-type` check, a body-size bound, and abuse control — before story 1.2 makes the endpoint act.
  evidence: `await request.json()` runs with no content-type check and no size bound, and there is no rate limiting anywhere. Exposure is minimal today because every path terminates in 501 before touching data, but the guard should exist before the boundary gains the ability to create, update and ban users.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Give the SPA a not-found route and a boot-failure fallback once the localization layer exists.
  evidence: `_redirects` maps every path to `index.html` at 200 and the router registers no `notFoundComponent` or `defaultErrorComponent`, so a genuine typo renders a blank shell with HTTP 200 — and DEPLOY.md's `curl /some/deep/route` check passes for typos too. `main.tsx` throws `ROOT_ELEMENT_MISSING` into a white screen. Both need user-facing text, which story 1.1a forbids and story 1.1b introduces, so they belong with the i18n layer.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Make `index.html`'s `lang` attribute follow the active locale, and add the missing document metadata.
  evidence: `lang="hr"` is a build-time literal with no mechanism to change it, which contradicts the localization contract that adding a language requires no component or logic change — and `lang` is exactly what screen readers and browser translation depend on. Also absent: `meta name="description"`, `theme-color`, a favicon (currently a 200-serving blank shell), a web manifest, and a `noscript` message for an application that does not function without JavaScript.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Add `lucide-react` as a pinned dependency before the first shadcn component carrying an icon is generated.
  evidence: `apps/web/components.json` declares `"iconLibrary": "lucide"`, so the first `shadcn add` of any icon-bearing primitive (Button with an icon, Select, Command, Dialog close) emits an import that cannot resolve. Nothing breaks until then, which is why it is easy to hit unexpectedly during story 1.1b.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Decide whether production builds should publish source maps.
  evidence: `apps/web/vite.config.ts` sets `build.sourcemap: true` unconditionally, so `.map` files ship to the public deployment and expose full original sources. The code is shipped to the browser regardless, so this is disclosure of readability and internal structure rather than of secrets — but for an application whose stated central invariant is key containment it deserves an explicit decision. `sourcemap: 'hidden'` or gating on mode are the options.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Add `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y` and a formatter to the lint setup.
  evidence: `eslint.config.js` documents why *typed* linting is absent (the TypeScript 7 API gap) but the React and accessibility rule sets do not depend on type information and are simply missing — so the rules most likely to catch real defects in `apps/web` are not running. `jsx-a11y` matters directly to the project's WCAG 2.1 AA target. There is also no Prettier config or `.editorconfig`, yet the diff is uniformly formatted, meaning a convention is being maintained by hand.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Constrain what `admin-auth` writes to its logs — codes, never operands or key material.
  evidence: The function logs `console.error('admin-auth could not construct its clients', cause)`, and the leak test asserts only on response bodies and headers. Nothing constrains what reaches Edge Function logs, where a client-construction error could echo connection material. Given how much else in this boundary is test-enforced, a log-hygiene rule plus an assertion is proportionate.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1a-deployable-shell.md`
  summary: Add the `apps/web` → `@shift/domain` workspace dependency edge when the first domain import lands.
  evidence: `apps/web/package.json` does not depend on `@shift/domain`, so `pnpm -r build` has no topological ordering between them and `@shift/domain` resolves through a gitignored, build-produced `./dist/index.js`. The Pages build command was changed to `--filter @shift/web...` so it will build dependencies once the edge exists, but the edge itself should be declared with the first import rather than discovered by a failing deploy.
