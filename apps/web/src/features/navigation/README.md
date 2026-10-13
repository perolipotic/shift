# `features/navigation/`

Which destinations each role reaches, as DATA — translation keys, route paths
and the roles that reach them, in binding order. Nothing here renders.

It is a `.ts` module rather than part of a component on purpose. L2 is an ESLint
`no-restricted-syntax` selector over JSX shapes, and `[{ label: 'Danas' }]` is
neither JSX nor a call, so no selector can reach it — the one L2 gap a syntactic
rule cannot close. Keeping the mapping as data moves the guarantee to a test that
executes it: `utils/destinations.test.ts` counts what each role yields and resolves
every key against `hr.json`.

`services/role.ts` reads the member's own level (bounded by a time budget) and
binds the reader the router's guards use, served through the chrome's query
entry. `services/admin-guard.ts` is the one admin route guard every admin-only
page registers, and the guard read `/ljudi` shares.

Keys, never labels. A string here that a person could read is the defect this
directory exists to make impossible.
