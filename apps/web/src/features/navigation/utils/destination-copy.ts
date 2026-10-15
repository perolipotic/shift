import type { NavigationKey } from '@/features/navigation/utils/destinations';

/**
 * The words the *Više* sheet and the phone bar add to a destination's label
 * (story 7.3's mockup, frames B and D), as KEYS per destination key.
 *
 * Separate from `destinations.ts` because that table carries keys, paths, roles
 * and groups and nothing else (`destinations.test.ts`), and because these are
 * copy rather than structure. Keyed by EVERY destination, not only the rows
 * the sheet shows today: which rows a sheet holds depends on the role's tabs,
 * and Epics 8.4, 10.3 and 14.2 add rows. A new destination is a
 * `pnpm typecheck` failure here until it has a description.
 *
 * The return types are written out as unions of literals, the shape the key
 * sweep in `prijava.test.ts` reads (`\w*MessageKey`), so every key here counts
 * as rendered.
 */

const DESCRIPTIONS: Readonly<Record<NavigationKey, ReturnType<typeof destinationDescriptionMessageKey>>> = {
  'nav.danas': 'shell.description.danas',
  'nav.kalendar': 'shell.description.kalendar',
  'nav.sati': 'shell.description.sati',
  'nav.godisnji': 'shell.description.godisnji',
  'nav.raspored': 'shell.description.raspored',
  'nav.ljudi': 'shell.description.ljudi',
  'nav.postavkeRotacije': 'shell.description.postavkeRotacije',
  'nav.organizacija': 'shell.description.organizacija',
};

/** A sheet row's one-line description: what the person finds behind it. */
export function destinationDescriptionMessageKey(
  key: NavigationKey,
):
  | 'shell.description.danas'
  | 'shell.description.kalendar'
  | 'shell.description.sati'
  | 'shell.description.godisnji'
  | 'shell.description.raspored'
  | 'shell.description.ljudi'
  | 'shell.description.postavkeRotacije'
  | 'shell.description.organizacija' {
  return DESCRIPTIONS[key];
}

/**
 * The place *Više* names under its own label while a destination it holds is
 * open (frame D: "Rotacija" on Postavke rotacije). The destination's own label
 * unless that is too long for a fifth of a 320 px bar, which only
 * *Postavke rotacije* is today.
 */
export function destinationPlaceMessageKey(key: NavigationKey): NavigationKey | 'shell.place.postavkeRotacije' {
  if (key === 'nav.postavkeRotacije') return 'shell.place.postavkeRotacije';

  return key;
}
