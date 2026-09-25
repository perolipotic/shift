import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronUp,
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

import { initialsOf } from '@/components/initials';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { destinationsFor, isCurrentDestination } from '@/navigation/destinations';
import { destinationIcon } from '@/navigation/icons';
import { useDismiss } from '@/navigation/dismiss';
import { navigationMessageKey } from '@/navigation/messages';
import { MEMBER_NAME_KEY, memberRoleLabelKey, readMemberName } from '@/navigation/profile';
import {
  MEMBERS_TABLE,
  MEMBER_ROLE_KEY,
  MEMBER_ROLE_UNAVAILABLE,
  readMemberRole,
  type MemberRoleFailure,
} from '@/navigation/role';
import { brandAccentAppearance } from '@/organization/accent';
import { OrganizationLockup } from '@/organization/lockup';
import { useRenderableLogo } from '@/organization/logo-url';
import {
  ORGANIZATION_READ_STALE_MS,
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  ORGANIZATION_UNAVAILABLE,
  readOrganization,
} from '@/organization/snapshot';
import { currentSession, supabaseClient } from '@/supabase/client';
import { SIGN_OUT_FAILED, signOut, type SignOutFailure } from '@/supabase/sign-out';
import {
  nextPreference,
  THEME_PREFERENCES,
  useThemePreference,
  type ThemePreference,
} from '@/theme/theme';

/**
 * The navigation chrome: two layouts, one architecture (the navigation shell,
 * part B).
 *
 * Part A registered eight destinations and the table that maps roles to them,
 * and shipped no way to reach any of them — `destinationsFor` was called by
 * nothing and the layout rendered a bare outlet. This is what calls it.
 *
 * BOTTOM TABS BELOW 640px, SIDEBAR AT AND ABOVE IT, and it is ONE list of links
 * rendered in two containers rather than two lists: the destinations, their
 * order, their icons and their active treatment are the same fact, and two
 * copies of it are two places for the fact to drift. `sm:` is the only
 * breakpoint, matching Tailwind's own 640px; the bar is `sm:hidden` and the
 * aside is `hidden sm:flex`, so exactly one of the two is in the accessibility
 * tree at any width — which is also why both `<nav>` landmarks may carry the
 * same name without ever being two things called the same thing.
 *
 * THE EXIT IS IN BOTH BARS AND IN NEITHER COLLAPSE. It sits inside each `<nav>`
 * but OUTSIDE the collapsible region, because a collapse that takes the way out
 * of the application with it is a collapse that can strand somebody on a shared
 * device — and the state resets on reload, so the way back is a page refresh
 * nobody would think to try.
 *
 * THE ROLE IS READ, NEVER CLAIMED. `@/navigation/role` explains why at length;
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
 * it reaches the sidebar alone — the phone's bottom bar renders the same
 * entries outside that group and always shows their names.
 *
 * NOTHING IS PERSISTED. The collapse lives in `useState` and resets on every
 * load, matching the theme layer's stance for the same reason: these are shared
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
 * `@/organization/accent` holds the three slots the tint may land in and the
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
 * REPORTED ONCE, NOT PER LAYOUT. The lockup is computed once and rendered into
 * both bars, exactly as `destinations` and `exit` are, and the logging happens
 * inside the query function rather than in a render — so a phone-width session
 * and a desktop one produce the same one console entry rather than one per bar.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, composed onto
 * every link and every button — the inherited primitives are `h-9`/`h-10`. The
 * bar scrolls in its own container rather than letting the page scroll
 * sideways: an admin reaches eight destinations plus the exit, and nine 44 px
 * targets do not fit across a phone. The lockup is NOT a control — nothing
 * about it is pressable — so it is 32 px rather than 44.
 */

export interface AppChromeProps {
  /** The destination, rendered inside the chrome rather than beside it. */
  readonly children: ReactNode;
}

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
  const profileRegion = useRef<HTMLDivElement>(null);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
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

  // A REFUSED PRESS IS ABOUT THE PRESS, and it stops being about anything the
  // moment the person moves on. Without this the alert followed them onto every
  // destination for the rest of the session — and, through the `??` above, sat
  // in front of a later role failure that nothing would then have shown.
  useEffect(() => {
    setProfileOpen(false);
    setFailure(null);
  }, [pathname]);

  useDismiss(profileOpen, profileRegion, closeProfile);

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
   * is somewhere a test can reach — the same reason `@/organization/logo-url`
   * keeps its own failure path out of the hook body. It logs and answers; the
   * caller falls back.
   */
  async function readBranding() {
    const outcome = await readOrganization(supabaseClient().from(ORGANIZATION_TABLE));

    if (!outcome.ok) console.error(ORGANIZATION_UNAVAILABLE, outcome.code);

    return outcome;
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
      if (!revoked) setFailure(SIGN_OUT_FAILED);
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
   * The destinations this role reaches, as links — or a skeleton, or nothing.
   *
   * NOTHING, and never an empty list, is what a failed or unrecognised role
   * produces: the alert below is what says so. A skeleton rather than a spinner
   * (UX-DR40) while the one read is still pending, and it is gated on `isPending`
   * rather than on "no role yet" — gated the other way, a settled failure pulses
   * forever and is indistinguishable from a slow network.
   */
  function renderDestinations(): ReactNode {
    if (member.isPending) return <div className="h-11 w-full animate-pulse rounded-md bg-muted" />;

    if (role === null) return null;

    return destinationsFor(role).map((destination) => {
      const Icon = destinationIcon(destination.key);
      const name = t(destination.key);

      return (
        <Link
          key={destination.key}
          to={destination.path}
          // `aria-current="page"` AND a treatment that is not colour (UX-DR37):
          // the active entry is a filled `sidebar-primary` pill, and it is ALSO
          // semibold and underlined where its neighbours are neither. The pill
          // alone is not enough: a hovered neighbour takes the same filled
          // shape, so the weight and the underline are what make the active
          // entry readable to somebody who cannot tell the two fills apart; the
          // attribute is what makes it audible. All of them are driven by the
          // same attribute, so they cannot disagree.
          //
          // The focus ring is OFFSET by the sidebar colour, so it is always
          // drawn against navy (where `--sidebar-ring` clears 3:1) and never
          // against the pill it would touch at under 3:1.
          //
          // MATCHED AS A SECTION, not as a string. Every destination here is a
          // section rather than a leaf, and an equality test drops the signal on
          // the first child route — see `isCurrentDestination`, which is in the
          // data module because it is a rule with two polarities worth running.
          aria-current={isCurrentDestination(pathname, destination.path) ? 'page' : undefined}
          title={expanded ? undefined : name}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-normal text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar aria-[current=page]:bg-sidebar-primary aria-[current=page]:font-semibold aria-[current=page]:text-sidebar-primary-foreground aria-[current=page]:underline aria-[current=page]:underline-offset-4 sm:justify-start"
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="group-data-[collapsed=true]/sidebar:sr-only">{name}</span>
        </Link>
      );
    });
  }

  /**
   * The theme control (human decision 2026-09-25): sustav, svijetla or tamna.
   *
   * TWO SHAPES OF ONE PREFERENCE. Where there is room — the expanded sidebar —
   * it is a three-segment pill (sidebar redesign), each segment a toggle
   * button whose `aria-pressed` says which one holds. Where there is not — the
   * collapsed rail and the phone bar — it is one glyph that cycles
   * sustav → svijetla → tamna. Either way every name is the words, on
   * `aria-label` and `title`, and states a preference rather than an action:
   * a segment names the value it sets, the cycle names the value that holds.
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
        className="flex self-center rounded-full border-[1.5px] border-sidebar-foreground/50 p-0.5 group-data-[collapsed=true]/sidebar:hidden"
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

  function renderThemeCycle(): ReactNode {
    const name = themeNames()[theme];
    const Glyph = THEME_GLYPHS[theme];

    return (
      <Button
        className="h-11 w-11 shrink-0 p-0"
        type="button"
        variant="sidebar"
        aria-label={name}
        title={name}
        onClick={() => setTheme(nextPreference(theme))}
      >
        <Glyph aria-hidden className="size-5" />
      </Button>
    );
  }

  /**
   * The exit: inside the profile menu on the sidebar, directly in the phone
   * bar, where there is no menu to put it in. The `sm:` classes are the menu's
   * — the phone bar is gone at that width.
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
        className="h-11 shrink-0 gap-2 px-4 sm:w-full sm:justify-start sm:border-0"
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
   * name and role, and a disclosure whose panel holds the exit (human decision
   * 2026-09-26 — the mockup has no exit of its own).
   *
   * The name is its own read (`@/navigation/profile`) and is decoration: while
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
            className="absolute bottom-full left-0 z-10 mb-2 flex w-full min-w-48 flex-col rounded-lg border border-sidebar-border bg-sidebar p-2 shadow-sh-lg group-data-[collapsed=true]/sidebar:bottom-0 group-data-[collapsed=true]/sidebar:left-full group-data-[collapsed=true]/sidebar:mb-0 group-data-[collapsed=true]/sidebar:ml-3 group-data-[collapsed=true]/sidebar:w-auto"
          >
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
   * The lockup, rendered into whichever of the two bars is on screen.
   *
   * COMPUTED ONCE, exactly as `destinations` and `exit` are, and for the same
   * reason: the organization's branding is one fact, and two copies of the
   * element are two places for the fallback, the accessible name and the accent
   * to drift apart. It is also what keeps the read's failure reported once.
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
  const destinations = renderDestinations();
  const lockup = renderLockup();
  const exit = renderSignOut();

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
          {lockup}
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
          {renderThemeSegments()}
          <div className="hidden justify-center group-data-[collapsed=true]/sidebar:flex">
            {renderThemeCycle()}
          </div>
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
            the device this story is written for. */}
        <div className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:pb-0">
          {children}
        </div>
        {/* `overflow-x-auto` on the landmark and `shrink-0` on every entry: an
            admin reaches eight destinations plus the exit, and nine 44 px
            targets do not fit across a phone. Wide content scrolls in its own
            container so the PAGE never scrolls sideways, which is the rule this
            bar would otherwise be the first thing to break. */}
        <div
          className={`sticky bottom-0 flex items-center gap-2 border-t bg-sidebar p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] text-sidebar-foreground sm:hidden ${accent.edge}`}
        >
          {/* The lockup is branding, not a destination, so it belongs OUTSIDE
              the navigation landmark, and outside the SCROLLER too: a lockup
              inside the scrolling region is branding that scrolls away while
              stealing width from targets that already do not fit. The phone
              has no profile card, so the exit sits in the bar directly. */}
          {lockup}
          {renderThemeCycle()}
          <nav
            aria-label={t('shell.navigation')}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          >
            {destinations}
            {exit}
          </nav>
        </div>
      </div>
    </div>
  );
}
