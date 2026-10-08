import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronUp,
  Ellipsis,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { initialsOf } from '@/utils/initials';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import {
  destinationsFor,
  isCurrentDestination,
  phoneNavigationFor,
  type Destination,
} from '@/features/navigation/utils/destinations';
import { destinationIcon } from '@/features/navigation/utils/icons';
import { useDismiss } from '@/hooks/dismiss';
import { useCloseWhenWide } from '@/hooks/viewport';
import { navigationMessageKey } from '@/features/navigation/utils/messages';
import { MEMBER_NAME_KEY, memberRoleLabelKey, readMemberName } from '@/features/navigation/services/profile';
import {
  MEMBERS_TABLE,
  MEMBER_ROLE_KEY,
  MEMBER_ROLE_UNAVAILABLE,
  readMemberRole,
  type MemberRoleFailure,
} from '@/features/navigation/services/role';
import { brandAccentAppearance } from '@/features/organization/utils/accent';
import { OrganizationLockup } from '@/features/organization/components/lockup';
import { useRenderableLogo } from '@/features/organization/hooks/logo-url';
import {
  ORGANIZATION_READ_STALE_MS,
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  ORGANIZATION_UNAVAILABLE,
  readOrganization,
} from '@/features/organization/services/snapshot';
import { currentSession, supabaseClient } from '@/lib/supabase/client';
import { SIGN_OUT_FAILED, signOut, type SignOutFailure } from '@/features/auth/services/sign-out';
import {
  THEME_PREFERENCES,
  useThemePreference,
  type ThemePreference,
} from '@/lib/theme';

/**
 * The navigation chrome: two layouts, one architecture (the navigation shell,
 * part B).
 *
 * Part A registered eight destinations and the table that maps roles to them,
 * and shipped no way to reach any of them — `destinationsFor` was called by
 * nothing and the layout rendered a bare outlet. This is what calls it.
 *
 * BOTTOM TABS BELOW 640px, SIDEBAR AT AND ABOVE IT, and ONE `<Link>` element
 * renders every destination in both — the sidebar entry, the phone tab and the
 * row in the *Više* sheet — rather than one list per layout: the destinations,
 * their icons and their active treatment are the same fact, and two copies of
 * it are two places for the fact to drift. Where a link sits changes only its
 * shape, through its container's `*:` classes. `sm:` is the only breakpoint, matching
 * Tailwind's own 640px; the bar is `sm:hidden` and the aside is
 * `hidden sm:flex`, so exactly one of the two is in the accessibility tree at
 * any width — which is also why both `<nav>` landmarks may carry the same name
 * without ever being two things called the same thing.
 *
 * THE PHONE BAR IS FIVE EQUAL CELLS (story 7.3): four fixed tabs per role and
 * *Više*. Which four is data (`phoneNavigationFor`), executed by
 * `destinations.test.ts`, never a filter written here. *Više* opens a bottom
 * sheet on the one native `Dialog`, so the browser supplies the focus trap,
 * Escape and the return of focus to *Više*. The sheet holds the role's other
 * destinations in two groups (Pregled: everyone's; Postavke: admin-only), the
 * theme and Odjava. While the current route is one of the sheet's
 * destinations, *Više* carries `aria-current` and the active treatment, so the
 * bar always marks where the person is. Nothing scrolls sideways: at 320 px
 * each cell is 64 px wide.
 *
 * THE EXIT IS IN BOTH LAYOUTS AND IN NEITHER COLLAPSE. On a phone it is in the
 * *Više* sheet; on the sidebar it is in the profile menu, OUTSIDE the
 * collapsible region, because a collapse that takes the way out of the
 * application with it is a collapse that can strand somebody on a shared
 * device — and the state resets on reload, so the way back is a page refresh
 * nobody would think to try. The theme sits beside it in both places.
 *
 * THE ROLE IS READ, NEVER CLAIMED. `@/features/navigation/services/role` explains why at length;
 * what matters here is that this component holds NO role logic of its own. It
 * asks for the role, hands it to `destinationsFor`, and renders what comes back
 * — so "a member reaches four destinations and no configuration surface" stays a
 * property of the table that `destinations.test.ts` executes, rather than of a
 * filter written in markup that nothing can run (AD-15).
 *
 * AN UNRECOGNISED OR UNREADABLE ROLE RENDERS NO DESTINATIONS AND SAYS SO. This
 * is the one behaviour the shape of the code has to protect: filtering an
 * unknown role to an empty list would render an empty bar, and an empty bar is
 * byte-identical to what a member with no access at all would see. THREE ways
 * the read can fail reach that message, and the third is the one a first draft
 * misses — `readMemberRole` never rejects, but `useQuery` can still settle in
 * `isError` (a queryFn that threw before the module was reached), and reading
 * only `data` leaves that case with no role AND no message, which is exactly the
 * empty bar. Every failure reaches ONE `role="alert"` region, rendered once and
 * outside both bars, because a second one would be a second thing competing to
 * be announced.
 *
 * THE MESSAGE COMES WITH SOMETHING TO PRESS. A failure resolves as DATA rather
 * than as a throw, so TanStack Query files it as settled: no retry, no refetch
 * on focus, nothing that recovers on its own. Telling somebody to try again with
 * nothing on screen that can is the dead affordance the voice rules exist to
 * prevent, so the alert carries a control that re-reads.
 *
 * COLLAPSING NARROWS THE SIDEBAR TO AN ICON RAIL (human decision 2026-09-25,
 * replacing the earlier "hide the list, never a glyph-only rail"). Expanded,
 * every entry shows its icon beside its Croatian name; collapsed, the sidebar
 * shows the icons alone. The NAME never leaves: it stays in the DOM as
 * screen-reader-only text, so assistive technology still hears it once, and it
 * is the entry's `title`, so a pointer user can read it on hover. The rail is
 * driven by the aside's `data-collapsed` through a `group/sidebar` variant, so
 * it reaches the sidebar alone — the phone's tabs and sheet render the same
 * link outside that group and always show their names.
 *
 * NOTHING IS PERSISTED. The collapse and the sheet live in `useState` and reset
 * on every load, matching the theme layer's stance for the same reason: these are shared
 * devices, and a layout one person chose following the next person into their
 * shift is a setting nobody asked for and nobody can find to undo.
 *
 * THE EXIT IS AN ORDINARY ACTION. `destructive` appears nowhere here — UX-DR4
 * reserves that token exclusively for an unresolved conflict, and signing out is
 * not one. A refused sign-out names the problem in the same one region and
 * leaves the person exactly where they were, because the session is still live
 * and navigating them to a sign-in screen would bounce straight back.
 *
 * THE ORGANIZATION IS READ HERE NOW, AND IT IS NOT A SECOND SNAPSHOT (story
 * 1.4c). The line this replaces said the opposite and told a later story where
 * to come back to: the chrome carried no organization read, and carrying one to
 * pre-fill a slug on a screen it was about to leave would have been a second
 * snapshot on a surface that has none. This is the revisit, and the AD-13
 * arithmetic is the other way round. AD-13 forbids two figures on a screen
 * coming from two READS; `ORGANIZATION_SNAPSHOT_KEY` is one constant key over
 * the one `QueryClient` `main.tsx` builds, so the chrome and `/organizacija`
 * share a single cache entry — a second consumer of one key, which is the
 * opposite of the failure. Two keys would be the violation.
 *
 * THE LOCKUP AND THE SHELL CHROME ARE THE WHOLE OF THE TINT (UX-DR5). The
 * accent reaches the lockup's mark and frame and the two bars' edges, and
 * nothing else: every shift fill, every modifier signal, `primary` and
 * `destructive` are byte-identical to an organization that has chosen none.
 * `@/features/organization/utils/accent` holds the three slots the tint may land in and the
 * class literals for each accent, because Tailwind resolves utilities by
 * scanning source text and a class built from a variable paints nothing at all.
 *
 * AN ORGANIZATION THAT CANNOT BE READ STILL GETS ITS NAVIGATION. The read's
 * failure never reaches the alert region: a person who cannot see their own
 * organization's branding has nothing to do about it, and the region already
 * carries the two refusals that ARE actionable — the role read, which removes
 * the destinations, and a refused sign-out. The lockup falls back to a skeleton
 * and then to nothing, the failure is logged where somebody can diagnose it,
 * and the shell renders. An empty shell is the one state this component exists
 * to make impossible, and that is as true of the branding as it is of the role.
 *
 * THE LOCKUP IS THE SIDEBAR'S ALONE since story 7.3: the phone bar gave its
 * width to the five cells, and the *Više* sheet names the organization in
 * words beside the person. It is rendered once, and the logging happens inside
 * the query function rather than in a render, so a session produces one
 * console entry for one unreadable logo.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, composed onto
 * every link and every button — the inherited primitives are `h-9`/`h-10`. A
 * phone cell is taller still (56 px, icon over label), and the bar is 4 rem
 * plus its 1 px edge, which is what the content's bottom padding and the
 * page's `scroll-padding-bottom` (`index.css`) clear. The lockup is NOT a
 * control — nothing about it is pressable — so it is 32 px rather than 44.
 */

export interface AppChromeProps {
  /** The destination, rendered inside the chrome rather than beside it. */
  readonly children: ReactNode;
}

/** Where the one link renders. Numbers, not words: a place is never text. */
const PLACE = { sidebar: 0, tab: 1, sheet: 2 } as const;
type Place = (typeof PLACE)[keyof typeof PLACE];

const THEME_GLYPHS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export function AppChrome({ children }: AppChromeProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The PATH the router currently resolves, read from router state rather than
  // from `window.location`: it is what a navigation updates, so the active entry
  // moves with the router instead of with a full page load.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [expanded, setExpanded] = useState(true);
  const [theme, setTheme] = useThemePreference();
  const [profileOpen, setProfileOpen] = useState(false);
  // The phone's *Više* sheet. Never persisted, like the collapse.
  const [moreOpen, setMoreOpen] = useState(false);
  const profileRegion = useRef<HTMLDivElement>(null);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const closeMoreWhenWide = useCallback(() => setMoreOpen(false), []);
  // A REF as well as state, and the two are not redundant — the shape every
  // handler in this application uses: state drives the disabled button, and
  // state is stale inside a handler already called once this tick, so a second
  // press (double click, Enter as the click lands) would start a second
  // revocation. The ref is written synchronously, so it is what the guard reads.
  const leaving = useRef(false);
  const alertRegion = useRef<HTMLParagraphElement>(null);
  const [failure, setFailure] = useState<SignOutFailure | null>(null);
  const [pending, setPending] = useState(false);

  const member = useQuery({
    queryKey: MEMBER_ROLE_KEY,
    queryFn: () => readMemberRole(supabaseClient().from(MEMBERS_TABLE), currentSession),
  });

  // THE SAME KEY `/organizacija` READS UNDER, which is what makes this one cache
  // entry rather than a second snapshot — see the header.
  //
  // BOUNDED ON ALL THREE COUNTS, because this one renders EVERYWHERE. The
  // settings surface's copy of this read is a screen somebody opens
  // deliberately; this one mounts on every signed-in destination, so an
  // unbounded version refetches the row on every navigation and every window
  // focus, and retries a transport fault three times before settling — for a
  // logo and a border colour. A refusal resolves as DATA rather than as a
  // throw, so `retry: false` is about the transport faults that do throw.
  //
  // AND IT IS LOGGED. The header claims an unreadable organization is
  // diagnosable; silence is what would make that false. It still reaches no
  // message region — a person who cannot see their own branding has nothing to
  // do about it, and the one `role="alert"` here carries the two refusals that
  // ARE actionable.
  const memberNameRead = useQuery({
    queryKey: MEMBER_NAME_KEY,
    queryFn: () => readMemberName(supabaseClient().from(MEMBERS_TABLE), currentSession),
  });
  const memberName = memberNameRead.data ?? null;

  const organizationRead = useQuery({
    queryKey: ORGANIZATION_SNAPSHOT_KEY,
    queryFn: readBranding,
    retry: false,
    staleTime: ORGANIZATION_READ_STALE_MS,
  });

  const organizationAnswer = organizationRead.data;
  const organization =
    organizationAnswer !== undefined && organizationAnswer.ok ? organizationAnswer.snapshot : null;
  // ONE HOOK, SHARED WITH THE SETTINGS SURFACE. Two copies of this were two
  // `queryFn`s registered for one query key, so whichever surface mounted first
  // owned the fetch and the other's cache bound and retry policy were dead code
  // that read as live.
  const logo = useRenderableLogo(organization === null ? null : organization.logoPath);
  const accent = brandAccentAppearance(organization === null ? null : organization.brandAccent);

  const answered = member.data;
  const role = answered !== undefined && answered.ok ? answered.role : null;
  // THREE OUTCOMES, and `isError` is the third. `readMemberRole` folds every
  // failure it knows about into `{ ok: false, code }`, which `useQuery` sees as
  // a resolved value — but the queryFn can still throw before reaching it (the
  // client's own `SUPABASE_ENVIRONMENT_MISSING` on a build with no environment),
  // and a version of this line that read only `data` left that case with no role
  // and no message: an empty bar, which is the one state this whole component is
  // written to make impossible.
  const roleFailure: MemberRoleFailure | null =
    answered !== undefined && !answered.ok
      ? answered.code
      : member.isError
        ? MEMBER_ROLE_UNAVAILABLE
        : null;
  // The sign-out's failure WINS over the read's: if a press has just been
  // refused, that is the thing the person is waiting to hear about, and the role
  // read's failure is still on screen as the absent destinations.
  const refusal: MemberRoleFailure | SignOutFailure | null = failure ?? roleFailure;
  // The phone layout, read off the table like the sidebar's list. No role, no
  // tabs and an empty *Više* — which still opens, for the theme and Odjava.
  const phone = role === null ? null : phoneNavigationFor(role);
  const more = phone === null ? { everyone: [], adminOnly: [] } : phone.more;
  // *Više* is current while the page is one of the destinations it holds, so
  // the bar always marks where the person is.
  const moreCurrent = [...more.everyone, ...more.adminOnly].some((destination) =>
    isCurrentDestination(pathname, destination.path),
  );

  // A REFUSED PRESS IS ABOUT THE PRESS, and it stops being about anything the
  // moment the person moves on. Without this the alert followed them onto every
  // destination for the rest of the session — and, through the `??` above, sat
  // in front of a later role failure that nothing would then have shown.
  //
  // The sheet closes on the same signal: following a row in it is a
  // navigation, and the page it opens should not sit behind a modal.
  useEffect(() => {
    setProfileOpen(false);
    setMoreOpen(false);
    setFailure(null);
  }, [pathname]);

  useDismiss(profileOpen, profileRegion, closeProfile);
  // The sheet is the phone's; a viewport that turns wide (a rotation, a
  // resize) would otherwise keep a modal open over the sidebar and return
  // focus to a hidden *Više*.
  useCloseWhenWide(moreOpen, closeMoreWhenWide);

  // MOVED TO, not merely announced. `role="alert"` reaches assistive technology
  // on insertion and reaches a sighted person not at all: on a phone the exit is
  // at the bottom of the viewport and this message renders at the top of the
  // content column, which is off screen at the moment of the press. Focus is
  // what puts the explanation where the person already is, and `tabIndex={-1}`
  // is what makes a paragraph focusable without putting it in the tab order.
  useEffect(() => {
    if (failure !== null) alertRegion.current?.focus();
  }, [failure]);

  /**
   * The organization, read for its branding and for nothing else.
   *
   * A NAMED FUNCTION rather than an arrow in the query options, so the logging
   * is somewhere a test can reach — the same reason `@/features/organization/hooks/logo-url`
   * keeps its own failure path out of the hook body. It logs and answers; the
   * caller falls back.
   */
  async function readBranding() {
    const outcome = await readOrganization(supabaseClient().from(ORGANIZATION_TABLE));

    if (!outcome.ok) console.error(ORGANIZATION_UNAVAILABLE, outcome.code);

    return outcome;
  }

  /**
   * Closes the sheet — never while a sign-out is in flight, so the close
   * button cannot do what `dismissible={!pending}` refuses Escape and the
   * backdrop. Read off the ref, which is current inside a handler.
   */
  function closeMore(): void {
    if (leaving.current) return;

    setMoreOpen(false);
  }

  function toggleNavigation(): void {
    setExpanded((shown) => !shown);
  }

  /** Re-reads the role. The only thing on screen that can clear its failure. */
  function retryDestinations(): void {
    void member.refetch();
  }

  async function leave(): Promise<void> {
    if (leaving.current) return;

    leaving.current = true;
    setFailure(null);
    setPending(true);

    // WHETHER THE SESSION ACTUALLY ENDED, tracked separately from whether this
    // function finished. Everything after the revocation can still fail — a
    // navigation rejects, an aborted route load throws — and reporting that as a
    // failed sign-out tells somebody "Odjava trenutačno nije moguća" while their
    // session is already gone, on a chrome that still looks signed in. The
    // session is the fact; the navigation is a consequence.
    let revoked = false;

    try {
      const outcome = await signOut(supabaseClient().auth);

      if (!outcome.ok) {
        // THE SESSION SURVIVED, so nothing navigates and nothing is cleared.
        // Sending somebody to a sign-in route here would render a form their
        // still-valid session bounces them off, which reads as "the button did
        // nothing" rather than as the failure it is.
        //
        // The sheet closes IN THE SAME RENDER as the failure lands: the alert
        // sits behind the modal, which makes it inert, and closing the sheet in
        // a later render would hand focus back to *Više* after the alert took
        // it.
        setMoreOpen(false);
        setFailure(outcome.code);

        return;
      }

      revoked = true;

      // EVERY CACHED ANSWER GOES WITH THE SESSION, and this is the shared-device
      // case the whole story is built around. `main.tsx` builds ONE `QueryClient`
      // for the page load, and a client-side navigation does not reload the page
      // — so without this, `['member-role']` and `['organization']` survive the
      // sign-out and the next person to sign in on the same device sees the
      // previous member's destinations and the previous organization's snapshot
      // until each refetch settles. `clear()` rather than invalidating two keys
      // by name: the rule is "nothing this session read outlives it", and a list
      // of keys to forget is a list somebody has to remember to grow.
      //
      // KEPT beside the app-wide rule in `main.tsx`
      // (`@/lib/supabase/session-cache`), which covers every other change of
      // user: this one is synchronous with the navigation below. The rule's
      // own router invalidation is deferred past this navigation, so it only
      // re-checks the `/prijava` the tab is already heading to.
      queryClient.clear();

      // BARE `/prijava`, discarding a slug this component never had. The
      // organization's slug lives on the `organizations` row, and nothing in the
      // signed-in chrome holds it: the token carries `organization_id`, a uuid,
      // and the destination routes carry no params at all. Carrying it would
      // mean the chrome issuing an organization read of its own purely to
      // pre-fill a field on a screen it is about to leave — a second snapshot on
      // a surface that has none, against AD-13, to save one person one short
      // typed word. Recorded rather than silently accepted: if the organization
      // snapshot ever legitimately reaches this component, this is the line to
      // revisit.
      await navigate({ to: '/prijava' });
    } catch (cause) {
      // Everything `signOut` does not already map, which is now exactly two
      // things: the client throwing its stable code on a build with no
      // environment, and a navigation that rejects. Both would otherwise escape
      // as an unhandled rejection, leaving a chrome with no message and a button
      // disabled forever.
      console.error(SIGN_OUT_FAILED, cause);

      // ONLY IF THE SESSION IS STILL THERE. Past `revoked`, the sign-out
      // SUCCEEDED and the person is signed out wherever they are standing; the
      // console carries the navigation failure and the screen must not claim the
      // opposite of what the database now believes.
      if (!revoked) {
        setMoreOpen(false);
        setFailure(SIGN_OUT_FAILED);
      }
    } finally {
      // On EVERY path, including the successful one. Clearing it only on failure
      // leaves the control dead the moment `navigate` stops resolving, with
      // nothing on screen to say why.
      leaving.current = false;
      setPending(false);
    }
  }

  function startSignOut(): void {
    void leave();
  }

  /**
   * A list of destinations as links — or a skeleton, or nothing.
   *
   * NOTHING, and never an empty list, is what a failed or unrecognised role
   * produces: the alert below is what says so. A skeleton rather than a spinner
   * (UX-DR40) while the one read is still pending, and it is gated on `isPending`
   * rather than on "no role yet" — gated the other way, a settled failure pulses
   * forever and is indistinguishable from a slow network. On the phone bar the
   * skeleton spans the four tab cells, and *Više* stays beside it.
   */
  function renderDestinations(list: readonly Destination[], place: Place): ReactNode {
    if (member.isPending) {
      return (
        <div
          className={
            place === PLACE.tab
              ? 'col-span-4 h-11 w-full animate-pulse rounded-md bg-muted'
              : 'h-11 w-full animate-pulse rounded-md bg-muted'
          }
        />
      );
    }

    if (role === null) return null;

    return list.map((destination) => renderLink(destination, place));
  }

  /**
   * THE ONE LINK. The sidebar entry, the phone tab and the sheet row are this
   * element. Where it sits changes only its shape, and the container does that
   * through `*:` classes on its children (the phone bar stacks icon over
   * label), so the link itself carries one treatment everywhere. `place` adds
   * only behaviour: the collapsed rail's tooltip belongs to the sidebar, and a
   * sheet row closes the sheet when pressed, even when it is the current page
   * and so changes no pathname.
   */
  function renderLink(destination: Destination, place: Place): ReactNode {
    const Icon = destinationIcon(destination.key);
    const name = t(destination.key);

    return (
      <Link
        key={destination.key}
        to={destination.path}
        // `aria-current="page"` AND a treatment that is not colour (UX-DR37),
        // all of it in the `shell-entry` utility (`index.css`), which *Više*
        // carries too, so the two cannot drift:
        // the active entry is a filled `sidebar-primary` pill, and it is ALSO
        // semibold and underlined where its neighbours are neither. The pill
        // alone is not enough: a hovered neighbour takes the same filled
        // shape, so the weight and the underline are what make the active
        // entry readable to somebody who cannot tell the two fills apart; the
        // attribute is what makes it audible. All of them are driven by the
        // same attribute, so they cannot disagree.
        //
        // The focus ring (also in `shell-entry`) is OFFSET by the sidebar colour, so it is always
        // drawn against navy (where `--sidebar-ring` clears 3:1) and never
        // against the pill it would touch at under 3:1.
        //
        // MATCHED AS A SECTION, not as a string. Every destination here is a
        // section rather than a leaf, and an equality test drops the signal on
        // the first child route — see `isCurrentDestination`, which is in the
        // data module because it is a rule with two polarities worth running.
        aria-current={isCurrentDestination(pathname, destination.path) ? 'page' : undefined}
        title={place === PLACE.sidebar && !expanded ? name : undefined}
        onClick={place === PLACE.sheet ? closeMore : undefined}
        className="shell-entry flex h-11 min-w-0 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-normal text-sidebar-foreground sm:justify-start"
      >
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="max-w-full truncate group-data-[collapsed=true]/sidebar:sr-only">{name}</span>
      </Link>
    );
  }

  /**
   * The theme control (human decision 2026-09-25): sustav, svijetla or tamna.
   *
   * ONE SHAPE, IN TWO PLACES (story 7.3): a three-segment pill, each segment a
   * toggle button whose `aria-pressed` says which one holds. It sits beside
   * Odjava in both layouts — in the sidebar's profile menu and in the phone's
   * *Više* sheet — so the bar and the sidebar foot carry no theme control of
   * their own. Every name is the words, on `aria-label` and `title`, and names
   * the value the segment sets.
   */
  function themeNames(): Record<ThemePreference, string> {
    // Three literal calls rather than one templated key: the key sweep in
    // `prijava.test.ts` reads keys off the source and cannot see through a
    // template.
    return {
      system: t('shell.theme.system'),
      light: t('shell.theme.light'),
      dark: t('shell.theme.dark'),
    };
  }

  function renderThemeSegments(): ReactNode {
    const names = themeNames();

    return (
      <div
        role="group"
        aria-label={t('shell.theme.label')}
        className="flex w-fit self-center rounded-full border-[1.5px] border-sidebar-foreground/50 p-0.5"
      >
        {THEME_PREFERENCES.map((preference) => {
          const Glyph = THEME_GLYPHS[preference];

          return (
            <Button
              key={preference}
              className="h-11 w-11 rounded-full border-0 p-0 aria-pressed:bg-sidebar-primary aria-pressed:text-sidebar-primary-foreground"
              type="button"
              variant="sidebar"
              aria-pressed={theme === preference}
              aria-label={names[preference]}
              title={names[preference]}
              onClick={() => setTheme(preference)}
            >
              <Glyph aria-hidden className="size-4" />
            </Button>
          );
        })}
      </div>
    );
  }

  /**
   * The exit: inside the profile menu on the sidebar, and in the *Više* sheet
   * on a phone. Full width in both; the `sm:` classes are the menu's.
   *
   * ITS NAME DOES NOT CHANGE WHILE IT IS BUSY, deliberately. A disclosure has
   * two STATES and a name that says which one it will produce; this has one
   * action, and a control whose name changes under the pointer is a control
   * voice control can no longer be told to press. `aria-busy` announces the
   * state and `disabled` takes it out of the tab order while the revocation is
   * in flight, which is the pair that carries "in progress" without renaming
   * anything.
   */
  function renderSignOut(): ReactNode {
    const name = t('shell.signOut');

    return (
      <Button
        className="h-11 w-full shrink-0 gap-2 px-4 sm:justify-start sm:border-0"
        type="button"
        variant="sidebar"
        disabled={pending}
        aria-busy={pending}
        onClick={startSignOut}
      >
        <LogOut aria-hidden className="size-4 shrink-0" />
        <span>{name}</span>
      </Button>
    );
  }

  /**
   * The profile card at the foot of the sidebar (sidebar redesign): initials,
   * name and role, and a disclosure whose panel holds the theme and the exit
   * (human decision 2026-09-26; the theme moved in with story 7.3).
   *
   * The name is its own read (`@/features/navigation/services/profile`) and is decoration: while
   * it is missing the card says the role alone, and the chip falls back to a
   * glyph. Collapsed, the card is the chip, and the words stay as its name.
   *
   * The panel opens OUT OF the rail when collapsed, which is why the aside does
   * not scroll — the destination list does — and so does not clip it. Escape,
   * a press outside and a navigation all close it.
   */
  function renderProfile(): ReactNode {
    const roleName = role === null ? null : t(memberRoleLabelKey(role));
    const initials = memberName === null ? null : initialsOf(memberName);
    const Chevron = profileOpen ? ChevronDown : ChevronUp;

    return (
      <div ref={profileRegion} className="relative">
        {profileOpen ? (
          <div
            id="profile-menu"
            className="absolute bottom-full left-0 z-10 mb-2 flex w-full min-w-48 flex-col gap-2 rounded-lg border border-sidebar-border bg-sidebar p-2 shadow-sh-lg group-data-[collapsed=true]/sidebar:bottom-0 group-data-[collapsed=true]/sidebar:left-full group-data-[collapsed=true]/sidebar:mb-0 group-data-[collapsed=true]/sidebar:ml-3 group-data-[collapsed=true]/sidebar:w-auto"
          >
            {renderThemeSegments()}
            {renderSignOut()}
          </div>
        ) : null}
        <Button
          className="h-auto min-h-11 w-full justify-start gap-3 border-0 px-2 py-1.5 text-left group-data-[collapsed=true]/sidebar:w-11 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0"
          type="button"
          variant="sidebar"
          aria-expanded={profileOpen}
          aria-controls="profile-menu"
          title={expanded ? undefined : (memberName ?? roleName ?? undefined)}
          onClick={() => setProfileOpen((open) => !open)}
        >
          <Avatar className="bg-sidebar-accent text-sidebar-accent-foreground">
            {initials ?? <User className="size-4" />}
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col group-data-[collapsed=true]/sidebar:sr-only">
            <span className="truncate text-sm font-semibold">{memberName ?? roleName}</span>
            {memberName === null || roleName === null ? null : (
              <span className="truncate text-xs font-normal text-sidebar-foreground/70">
                {roleName}
              </span>
            )}
          </span>
          <Chevron
            aria-hidden
            className="size-4 shrink-0 group-data-[collapsed=true]/sidebar:hidden"
          />
        </Button>
      </div>
    );
  }

  /**
   * The phone's *Više* sheet (story 7.3): who is signed in, the role's other
   * destinations in two groups, the theme and Odjava.
   *
   * THE ONE `Dialog`, docked at the bottom, so it is modal the way every other
   * dialog here is: the browser traps focus, Escape and a backdrop press close
   * it, and focus returns to *Više*. A group renders only when it has rows, so
   * a member's sheet holds the theme and Odjava and nothing else. Navy, like
   * the bar it opens from, so the one link keeps the one treatment.
   *
   * Not dismissible while a sign-out is in flight, so the request cannot lose
   * the sheet before it answers; a refusal closes it in the same render the
   * alert arrives in (see `leave`).
   */
  function renderMore(): ReactNode {
    const roleName = role === null ? null : t(memberRoleLabelKey(role));
    const organizationName = organization === null ? null : organization.name;
    const initials = memberName === null ? null : initialsOf(memberName);
    // TWO LINES THAT NEVER REPEAT: the first is the most personal fact there
    // is, the second whatever is left of role and organization, and a line
    // with nothing to say is not drawn.
    const primary = memberName ?? roleName ?? organizationName;
    const rest = memberName !== null ? [roleName, organizationName] : roleName !== null ? [organizationName] : [];
    const [first = null, second = null] = rest.filter((part) => part !== null);
    const secondary =
      first !== null && second !== null
        ? t('shell.identity', { role: first, organization: second })
        : first;
    const groups = [
      { id: 'more-everyone', label: t('shell.moreGroup.everyone'), rows: more.everyone },
      { id: 'more-admin-only', label: t('shell.moreGroup.adminOnly'), rows: more.adminOnly },
    ];

    return (
      <Dialog
        open={moreOpen}
        onOpenChange={setMoreOpen}
        dismissible={!pending}
        aria-label={t('shell.more')}
        className="mb-0 mt-auto w-full max-w-none rounded-b-none rounded-t-2xl border-x-0 border-b-0 border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom,0px)] text-sidebar-foreground"
      >
        <DialogHeader
          // The close is the primitive's `ghost` button; on navy it takes the
          // shell's hover and its ring offset by the sidebar, from here, so no
          // other dialog changes.
          className="[&>button]:hover:bg-sidebar-accent [&>button]:hover:text-sidebar-accent-foreground [&>button]:focus-visible:ring-sidebar-ring [&>button]:focus-visible:ring-offset-sidebar"
          closeLabel={t('shell.moreClose')}
          onClose={closeMore}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="bg-sidebar-accent text-sidebar-accent-foreground">
              {initials ?? <User className="size-4" />}
            </Avatar>
            <div className="grid min-w-0">
              {primary === null ? null : (
                <span className="truncate text-sm font-semibold">{primary}</span>
              )}
              {secondary === null ? null : (
                <span className="truncate text-xs text-sidebar-foreground/70">{secondary}</span>
              )}
            </div>
          </div>
        </DialogHeader>
        {groups.map((group) =>
          group.rows.length === 0 ? null : (
            <section key={group.id} aria-labelledby={group.id} className="grid gap-1 *:justify-start">
              <h2 id={group.id} className="font-sans text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/70">
                {group.label}
              </h2>
              {group.rows.map((destination) => renderLink(destination, PLACE.sheet))}
            </section>
          ),
        )}
        <section aria-labelledby="more-display" className="grid gap-2">
          <h2 id="more-display" className="font-sans text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/70">
            {t('shell.moreGroup.display')}
          </h2>
          {renderThemeSegments()}
        </section>
        {renderSignOut()}
      </Dialog>
    );
  }

  /**
   * The one message region, rendered once and outside both bars.
   *
   * OUTSIDE, because a message inside a bar that renders no destinations is a
   * message inside something the person has no reason to look at — and because
   * the two bars would then hold two of it.
   *
   * The retry belongs to the ROLE failure only. A refused sign-out already has
   * its retry: the exit itself, re-enabled by the handler's `finally`, so a
   * second control beside it would be two ways to do one thing.
   */
  function renderMessage(): ReactNode {
    if (refusal === null) return null;

    return (
      <div className="mx-3 mt-3 flex flex-col gap-2 rounded-lg border border-input bg-card px-3 py-2 shadow-sh sm:flex-row sm:items-center sm:justify-between">
        <p ref={alertRegion} role="alert" tabIndex={-1} className="text-sm font-medium">
          {t(navigationMessageKey(refusal))}
        </p>
        {roleFailure === null ? null : (
          <Button
            className="h-11 shrink-0 px-4"
            type="button"
            variant="outline"
            onClick={retryDestinations}
          >
            {t('shell.retry')}
          </Button>
        )}
      </div>
    );
  }

  /**
   * The lockup, rendered once, into the sidebar (the phone bar gave its width
   * to the five cells in story 7.3).
   *
   * One element, because the organization's branding is one fact, and two
   * copies of it are two places for the fallback, the accessible name and the
   * accent to drift apart. It is also what keeps the read's failure reported
   * once.
   */
  function renderLockup(): ReactNode {
    return (
      <OrganizationLockup
        organization={organization}
        logoUrl={logo.url}
        onUnrenderable={logo.onUnrenderable}
        pending={organizationRead.isPending}
        compact
      />
    );
  }

  const toggleName = expanded ? t('shell.menuHide') : t('shell.menuShow');
  const destinations = renderDestinations(role === null ? [] : destinationsFor(role), PLACE.sidebar);
  const tabs = renderDestinations(phone === null ? [] : phone.tabs, PLACE.tab);
  const moreName = t('shell.more');

  return (
    <div className="flex flex-1 flex-col sm:flex-row">
      {/* NAVY IN BOTH THEMES (visual refresh A), and sticky to the viewport so
          the profile at its foot stays reachable beside a long destination.
          The accent is the EDGE, never the fill: the organization tints the
          line between the chrome and the content and nothing inside it.

          NO FIXED WIDTH ON THE ASIDE: the width is the destination list's,
          and only while expanded, so collapsing leaves the aside as wide as
          one 44 px icon target and reclaims the space.

          THE ASIDE DOES NOT SCROLL; the destination list does. The profile
          menu opens out of the collapsed rail, and a scrolling aside would
          clip it. */}
      <aside
        data-collapsed={!expanded}
        className={`group/sidebar hidden shrink-0 flex-col gap-3 border-r bg-sidebar p-3 text-sidebar-foreground sm:sticky sm:top-0 sm:flex sm:h-dvh ${accent.edge}`}
      >
        {/* The organization: its mark, and its name beside it while there is
            room. The name is `aria-hidden` because the mark already carries it
            as its accessible name; read twice it would be noise. */}
        <div className="flex min-h-11 items-center gap-3 border-b border-sidebar-border pb-3 group-data-[collapsed=true]/sidebar:justify-center">
          {renderLockup()}
          {organization === null ? null : (
            <span
              aria-hidden
              className="truncate font-heading text-sm font-semibold group-data-[collapsed=true]/sidebar:hidden"
            >
              {organization.name}
            </span>
          )}
        </div>
        {/* THE COLLAPSIBLE REGION: collapsing narrows it to the icons and keeps
            every entry reachable. `aria-controls` on the collapse names it,
            which is why it is an element with an id. */}
        <nav
          id="app-destinations"
          aria-label={t('shell.navigation')}
          className={
            expanded
              ? '-mx-1 flex min-h-0 w-60 flex-1 flex-col gap-1 overflow-y-auto px-1'
              : '-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1'
          }
        >
          {destinations}
        </nav>
        <div className="flex flex-col gap-3 border-t border-sidebar-border pt-3">
          {renderProfile()}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The collapse lives on the page, beside the sidebar at the top
            (sidebar redesign), so the rail itself holds only destinations and
            the person. A glyph (human decision 2026-09-25): a panel closing
            while expanded, a panel opening while collapsed. Its NAME is still
            the words, on `aria-label` and `title`, and it says WHICH STATE THE
            PRESS PRODUCES, because a disclosure whose name is the same in both
            directions leaves `aria-expanded` as the only signal. */}
        <div className="hidden px-4 pt-4 sm:flex">
          <Button
            className="h-11 w-11 shrink-0 p-0"
            type="button"
            variant="outline"
            aria-expanded={expanded}
            aria-controls="app-destinations"
            aria-label={toggleName}
            title={toggleName}
            onClick={toggleNavigation}
          >
            {expanded ? (
              <PanelLeftClose aria-hidden className="size-5" />
            ) : (
              <PanelLeftOpen aria-hidden className="size-5" />
            )}
          </Button>
        </div>
        {renderMessage()}
        {/* Bottom padding that clears the sticky bar and the phone's own home
            indicator. The bar is `sticky`, so content scrolls UNDER it; without
            this the last thing on every destination is unreachable on exactly
            the device this story is written for. 4 rem is the bar (two 4 px
            paddings around a 56 px cell) and 1 px its edge. */}
        <div className="flex flex-1 flex-col pb-[calc(4rem+1px+env(safe-area-inset-bottom,0px))] sm:pb-0">
          {children}
        </div>
        {/* FIVE EQUAL CELLS AND NO SCROLLER (story 7.3): four tabs and *Više*,
            a grid on the landmark itself, so nothing can sit off screen — not
            even the current tab. No lockup, no theme and no exit here: the
            sheet holds the last two, and the sidebar the lockup. The `<nav>`
            stays the sticky bar's direct child; the calendar's layout test
            finds the bar as its sticky parent. */}
        <div
          className={`sticky bottom-0 border-t bg-sidebar pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] text-sidebar-foreground sm:hidden ${accent.edge}`}
        >
          <nav
            aria-label={t('shell.navigation')}
            className="grid grid-cols-5 items-center *:h-14 *:min-w-0 *:flex-col *:gap-1 *:px-1 *:text-xs"
          >
            {tabs}
            <Button
              className="shell-entry col-start-5 h-14 gap-1 rounded-md border-0 px-1 py-0 text-xs font-normal"
              type="button"
              variant="sidebar"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-current={moreCurrent ? 'page' : undefined}
              onClick={() => setMoreOpen(true)}
            >
              <Ellipsis aria-hidden className="size-4 shrink-0" />
              <span className="max-w-full truncate">{moreName}</span>
            </Button>
          </nav>
        </div>
        {renderMore()}
      </div>
    </div>
  );
}
