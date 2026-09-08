import type { RegisteredRouter } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';

/**
 * Which destinations each role reaches — as DATA, not as markup.
 *
 * UX-DR31 gives the member role four destinations and no configuration surface
 * at all; UX-DR32 adds four more for an admin (`epics.md:151-152`). `Sati` is
 * ONE destination with role-scoped content rather than two — the human decision
 * of 2026-09-04 that resolves the overlap between those two rules — so the
 * totals are four and eight, never nine.
 *
 * A `.ts` module rather than a component, and that is the whole reason this file
 * exists. L2 is an ESLint `no-restricted-syntax` selector over JSX shapes:
 * `[{ label: 'Danas' }]` is neither JSX nor a `t()` call, so no selector can
 * reach it, and it is the one L2 gap a syntactic rule cannot close. Keys in a
 * plain module move the guarantee from a rule that cannot see the mapping to a
 * test that EXECUTES it — `destinations.test.ts` counts what each role yields
 * and resolves every key against `hr.json`, which no regex over a component
 * could do.
 *
 * So: translation keys, never labels. Nothing in this file renders, and a
 * string here that a person could read would be exactly the defect the file was
 * written to make impossible.
 *
 * NAVIGATION CHROME IS NOT HERE. This is part A — the route skeleton. The tab
 * bar, the sidebar, the icons and the active-destination treatment are part B,
 * and they consume this table rather than re-deriving it.
 */

/** The permission levels the database stores (`0002_…sql:140`). `member_role`
 *  rather than `member`, because the glossary reserves "Member" for the person
 *  and a synonym is a contract violation. */
export type MemberRole = 'admin' | 'member_role';

/**
 * A `nav.*` key, typed off the resource file.
 *
 * `ParseKeys` is what `t()` itself is typed against (`i18n/index.ts:100-106`
 * declares `resources: { translation: typeof hr }`), so a key misspelt or
 * absent from `hr.json` is a `pnpm typecheck` failure here for the same reason
 * it is at a call site. The `Extract` narrows it to this file's own namespace,
 * so `auth.heading` in the table below would not compile either.
 */
export type NavigationKey = Extract<ParseKeys, `nav.${string}`>;

/**
 * A path the router actually registered.
 *
 * `string` would defeat the premise this whole story rests on. Eight routes are
 * built now, before their screens exist, because TanStack Router 1.170.32
 * typechecks `<Link to>` against the route tree — and part B renders its links
 * from the table below, so a `string` here widens straight past that check and
 * a typo'd path becomes a link to nowhere that compiles.
 *
 * `RegisteredRouter` is the augmentation `router.ts` declares, so this resolves
 * to the union of every registered path and a typo is a `pnpm typecheck`
 * failure. It reaches the router by TYPE only — nothing here imports `@/router`,
 * so no module cycle is created.
 */
export type RegisteredPath = keyof RegisteredRouter['routesByPath'];

/** One destination: the key that labels it, the path that reaches it, and the
 *  roles that may. */
export interface Destination {
  /** The label's translation key. NEVER the label. */
  readonly key: NavigationKey;
  /** The registered route path (`router.ts`). */
  readonly path: RegisteredPath;
  /** Every role that reaches it. */
  readonly roles: readonly MemberRole[];
}

const EVERYONE: readonly MemberRole[] = ['member_role', 'admin'];
const ADMIN_ONLY: readonly MemberRole[] = ['admin'];

/**
 * Every destination, in BINDING ORDER.
 *
 * The array's own order is the order — there is deliberately no `order: 3`
 * field beside an array index, because that is two sources of truth for one
 * fact and only one of them can be the one that renders. `destinationsFor`
 * preserves it by filtering rather than sorting, and `destinations.test.ts`
 * pins both sequences exactly rather than as sets.
 *
 * The admin's four are appended rather than interleaved: UX-DR32 describes them
 * as GROUPED configuration added to the member's four, so a member and an admin
 * see the same first four in the same order.
 */
export const DESTINATIONS: readonly Destination[] = [
  { key: 'nav.danas', path: '/danas', roles: EVERYONE },
  { key: 'nav.kalendar', path: '/kalendar', roles: EVERYONE },
  // ONE entry, not two. The role decides what `Sati` shows, never whether a
  // second destination by the same name exists.
  { key: 'nav.sati', path: '/sati', roles: EVERYONE },
  { key: 'nav.godisnji', path: '/godisnji', roles: EVERYONE },
  { key: 'nav.raspored', path: '/raspored', roles: ADMIN_ONLY },
  { key: 'nav.ljudi', path: '/ljudi', roles: ADMIN_ONLY },
  { key: 'nav.postavkeRotacije', path: '/postavke-rotacije', roles: ADMIN_ONLY },
  { key: 'nav.organizacija', path: '/organizacija', roles: ADMIN_ONLY },
];

/** The destinations a role reaches, in binding order. */
export function destinationsFor(role: MemberRole): readonly Destination[] {
  return DESTINATIONS.filter((destination) => destination.roles.includes(role));
}
