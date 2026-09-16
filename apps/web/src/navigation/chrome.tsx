import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { destinationsFor, isCurrentDestination } from '@/navigation/destinations';
import { destinationIcon } from '@/navigation/icons';
import { navigationMessageKey } from '@/navigation/messages';
import {
  MEMBERS_TABLE,
  MEMBER_ROLE_KEY,
  MEMBER_ROLE_UNAVAILABLE,
  readMemberRole,
  type MemberRoleFailure,
} from '@/navigation/role';
import { currentSession, supabaseClient } from '@/supabase/client';
import { SIGN_OUT_FAILED, signOut, type SignOutFailure } from '@/supabase/sign-out';

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
 * ICONS ARE DECORATION BESIDE A VISIBLE LABEL, never the label — every entry
 * carries its Croatian name at every width, in both layouts, and the icon is
 * `aria-hidden` so assistive technology hears the name once. Collapsing the
 * sidebar therefore hides the LIST rather than narrowing it to glyphs: an
 * icon-only rail is exactly the state that rule forbids, and there is no width
 * at which it is more acceptable than at any other.
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
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, composed onto
 * every link and every button — the inherited primitives are `h-9`/`h-10`. The
 * bar scrolls in its own container rather than letting the page scroll
 * sideways: an admin reaches eight destinations plus the exit, and nine 44 px
 * targets do not fit across a phone.
 */

export interface AppChromeProps {
  /** The destination, rendered inside the chrome rather than beside it. */
  readonly children: ReactNode;
}

export function AppChrome({ children }: AppChromeProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The PATH the router currently resolves, read from router state rather than
  // from `window.location`: it is what a navigation updates, so the active entry
  // moves with the router instead of with a full page load.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [expanded, setExpanded] = useState(true);
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
    setFailure(null);
  }, [pathname]);

  // MOVED TO, not merely announced. `role="alert"` reaches assistive technology
  // on insertion and reaches a sighted person not at all: on a phone the exit is
  // at the bottom of the viewport and this message renders at the top of the
  // content column, which is off screen at the moment of the press. Focus is
  // what puts the explanation where the person already is, and `tabIndex={-1}`
  // is what makes a paragraph focusable without putting it in the tab order.
  useEffect(() => {
    if (failure !== null) alertRegion.current?.focus();
  }, [failure]);

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

      return (
        <Link
          key={destination.key}
          to={destination.path}
          // `aria-current="page"` AND a treatment that is not colour (UX-DR37):
          // the weight and the underline are what make the active entry readable
          // to somebody who cannot tell the background apart from its
          // neighbours, and the attribute is what makes it audible. Both are
          // driven by the same attribute, so they cannot disagree.
          //
          // MATCHED AS A SECTION, not as a string. Every destination here is a
          // section rather than a leaf, and an equality test drops the signal on
          // the first child route — see `isCurrentDestination`, which is in the
          // data module because it is a rule with two polarities worth running.
          aria-current={isCurrentDestination(pathname, destination.path) ? 'page' : undefined}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium aria-[current=page]:bg-accent aria-[current=page]:font-bold aria-[current=page]:underline aria-[current=page]:underline-offset-4 sm:justify-start"
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          {t(destination.key)}
        </Link>
      );
    });
  }

  /**
   * The exit, rendered into whichever of the two bars is on screen.
   *
   * ITS NAME DOES NOT CHANGE WHILE IT IS BUSY, deliberately, and the reasoning
   * is the opposite of the toggle's a few lines down. A disclosure has two
   * STATES and a name that says which one it will produce; this has one action,
   * and a control whose name changes under the pointer is a control voice
   * control can no longer be told to press. `aria-busy` announces the state and
   * `disabled` takes it out of the tab order while the revocation is in flight,
   * which is the pair that carries "in progress" without renaming anything.
   */
  function renderSignOut(): ReactNode {
    return (
      <Button
        className="h-11 shrink-0 px-4"
        type="button"
        variant="outline"
        disabled={pending}
        aria-busy={pending}
        onClick={startSignOut}
      >
        {t('shell.signOut')}
      </Button>
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
      <div className="mx-3 mt-3 flex flex-col gap-2 rounded-md border border-input px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
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

  const destinations = renderDestinations();
  const exit = renderSignOut();

  return (
    <div className="flex flex-1 flex-col sm:flex-row">
      {/* NO FIXED WIDTH ON THE ASIDE. It sized itself at `w-56` in both states,
          so collapsing hid the list and reclaimed not one pixel — a control that
          visibly does nothing. The width is the destination list's now, so
          collapsing leaves the aside as wide as the toggle and the exit need. */}
      <aside className="hidden shrink-0 flex-col gap-2 border-r border-border p-3 sm:flex">
        {/* The toggle carries its own visible word rather than a glyph, for the
            reason every entry below does: an icon is not a name. Its name says
            WHICH STATE THE PRESS PRODUCES and changes with the state, because a
            disclosure whose name is the same in both directions leaves
            `aria-expanded` as the only signal — inaudible to anybody not using
            assistive technology and invisible to everybody else.
            `aria-controls` names the region it opens, which is why that region
            is an element with an id rather than a branch that renders nothing. */}
        <Button
          className="h-11 shrink-0 px-4"
          type="button"
          variant="outline"
          aria-expanded={expanded}
          aria-controls="app-destinations"
          onClick={toggleNavigation}
        >
          {expanded ? t('shell.menuHide') : t('shell.menuShow')}
        </Button>
        <nav aria-label={t('shell.navigation')} className="flex flex-col gap-1">
          {/* THE COLLAPSIBLE REGION, and it holds the destinations ALONE. The
              exit is a sibling below it, so collapsing never takes the way out
              of the application with it. */}
          <div id="app-destinations" className={expanded ? 'flex w-48 flex-col gap-1' : 'hidden'}>
            {destinations}
          </div>
          {exit}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {renderMessage()}
        {/* Bottom padding that clears the sticky bar and the phone's own home
            indicator. The bar is `sticky`, so content scrolls UNDER it; without
            this the last thing on every destination is unreachable on exactly
            the device this story is written for. */}
        <div className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom,0px))] sm:pb-0">
          {children}
        </div>
        {/* `overflow-x-auto` on the bar and `shrink-0` on every entry: an admin
            reaches eight destinations plus the exit, and nine 44 px targets do
            not fit across a phone. Wide content scrolls in its own container so
            the PAGE never scrolls sideways, which is the rule this bar would
            otherwise be the first thing to break. */}
        <nav
          aria-label={t('shell.navigation')}
          className="sticky bottom-0 flex items-center gap-1 overflow-x-auto border-t border-border bg-background p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] sm:hidden"
        >
          {destinations}
          {exit}
        </nav>
      </div>
    </div>
  );
}
