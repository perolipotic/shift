
import {
  Buildings,
  Calendar,
  CalendarDots,
  Clock,
  House,
  Repeat,
  TreePalm,
  Users,
  type IconComponent,
} from '@/components/ui/icon';
import type { NavigationKey } from '@/features/navigation/utils/destinations';

/**
 * The icon each destination carries — decoration, never the label.
 *
 * THE ICON IS NOT THE NAME. Every entry in the chrome carries its Croatian
 * label beside its icon. The collapsed sidebar shows the icons alone (human
 * decision 2026-09-25), but the label stays as screen-reader text and as the
 * entry's `title`, so no entry is ever a glyph without a name. The
 * assignment below is the human decision of 2026-09-16 and it is recorded here
 * rather than argued: `Danas` Home, `Kalendar` Calendar, `Sati` Clock,
 * `Godišnji` TreePalm, `Za odluku` CalendarRange, `Ljudi` Users, `Postavke
 * rotacije` Repeat, `Organizacija` Building2 — lucide's names; since story
 * 15.1 the Phosphor glyphs `House`, `Calendar`, `Clock`, `TreePalm`,
 * `CalendarDots`, `Users`, `Repeat` and `Buildings`, through
 * `@/components/ui/icon`.
 *
 * A `.ts` MODULE AND NOT PART OF THE CHROME, and the reason is mechanical rather
 * than tidy: the map is keyed by `nav.*` key, which means writing eight quoted
 * key literals — and `pages/literal-sweep.test.ts` sweeps every `.tsx` under
 * `apps/web/src` for exactly that, a string literal that is neither a `t()`
 * argument nor a structural attribute. Keeping the keys out of the component is
 * what lets the chrome stay inside that sweep rather than be excused from it.
 *
 * A `Record<NavigationKey, …>` AND NOT A LOOKUP WITH A FALLBACK. `NavigationKey`
 * is typed off `hr.json` (`@/features/navigation/utils/destinations`), so a ninth destination
 * fails `pnpm typecheck` here until it is given an icon, and a key removed from
 * the resource file fails here too. A `Partial` with a default icon would make
 * both of those silent, and the symptom — every new destination wearing the same
 * generic glyph — is the kind nobody reports.
 *
 * NOT IN `destinations.ts`, deliberately. That module is data with no React in
 * it at all, and `destinations.test.ts` walks every string on every entry to
 * prove no entry carries anything but a key, a path and a role name. An icon on
 * an entry is a React component object whose own fields are strings, which would
 * fail that sweep for a reason that has nothing to do with what it guards.
 */
const DESTINATION_ICONS: Record<NavigationKey, IconComponent> = {
  'nav.danas': House,
  'nav.kalendar': Calendar,
  'nav.sati': Clock,
  'nav.godisnji': TreePalm,
  'nav.zaOdluku': CalendarDots,
  'nav.ljudi': Users,
  'nav.postavkeRotacije': Repeat,
  'nav.organizacija': Buildings,
};

/**
 * The icon a destination is drawn with.
 *
 * A FUNCTION rather than the exported record, so there is one place to look and
 * so the claim is executable: the map above is total by type, and a reader that
 * returned one icon for everything would be caught by the test that compares
 * what the eight destinations resolve to.
 */
export function destinationIcon(key: NavigationKey): IconComponent {
  return DESTINATION_ICONS[key];
}
