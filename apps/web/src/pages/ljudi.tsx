import { Link, createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Plus, UsersRound } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { MemberAddDialog } from '@/features/members/components/member-add-dialog';
import { MemberTable } from '@/features/members/components/member-table';
import { useMemberCreate, type MemberAddNavigate } from '@/features/members/hooks/use-member-create';
import { useMemberList, type MembersNavigate } from '@/features/members/hooks/use-member-list';
import {
  MEMBERS_ADD_OPEN,
  MEMBERS_ERROR_ID,
  MEMBERS_PAGE_HEADING_ID,
  mayReadMembers,
  membersAddSearchOf,
  membersMessageKey,
  membersSearchOf,
  type LjudiSearch,
} from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Ljudi` — the member list (story 1.5a). This file composes the screen; its
 * state and its one read are `useMemberList`, its sections are components in
 * `@/features/members/components`, and every rule is `@/features/members/services/list`'s.
 *
 * THE FILTERS ARE IN THE URL (story 7.13): `?trazi=&razina=&smjena=&status=&sort=`,
 * validated here by `membersSearchOf` — an unknown value falls back to its
 * default — and written by the hook through `navigate`. The list opens on the
 * members active today; one summary line under the chips says what is shown.
 *
 * ADMIN ONLY, AND THE FIRST ROUTE IN THE TREE WHERE THAT IS TRUE. The screen
 * holds every colleague's address and leave allowance, UX-DR31 gives the member
 * role no configuration surface, and UX-DR32 groups `Ljudi` under
 * configuration; the member-facing view of people is story 1.8's team detail.
 * THE GUARD PROTECTS NOTHING AGAINST A DIRECT API CALL, and is not pretending
 * to: `members_select_own_organization` carries no role filter (`0003:286-288`).
 * What it settles is an IA question — which screen a level reaches.
 *
 * *DODAJ OSOBU* IS A DIALOG ON THIS SCREEN (story 7.13b), and its open state
 * is the URL's: `?dodaj=1`, parsed beside the filters by `membersAddSearchOf`.
 * Opening pushes an entry, so Back closes it; closing replaces the entry; every
 * filter write carries the current `dodaj` through. Its state and its one write
 * are `useMemberCreate`'s. Editing a member is `/ljudi/$id`, which this screen
 * links to; `/ljudi/novi` is a redirect to the dialog.
 */

/** Where a refused session is sent: the FIRST destination, in binding order,
 *  read from the table rather than written as a path, and reusing what `/`
 *  already decided (`pages/index.tsx`). */
const FIRST_DESTINATION = DESTINATIONS[0];

export function LjudiScreen() {
  const search = ljudiRoute.useSearch();
  const navigate = useNavigate({ from: ljudiRoute.fullPath });
  // ONE FUNCTION FOR THE SCREEN'S LIFE, so the hook's effects that write the
  // URL do not re-run for a new closure on every render. THE DIALOG'S `dodaj`
  // IS CARRIED THROUGH, read at the moment of the write — the stale-team
  // replace included, which would otherwise close an open dialog.
  const write = useCallback<MembersNavigate>(
    (next, { replace }) => {
      void navigate({ search: (current) => ({ ...next, ...membersAddSearchOf(current) }), replace });
    },
    [navigate],
  );
  // OPENING PUSHES `?dodaj=1`, so Back closes the dialog; CLOSING REPLACES the
  // entry, so it leaves no open state to step back into.
  const writeAdding = useCallback<MemberAddNavigate>(
    (open, options) => {
      void navigate({
        search: (current) => ({ ...current, dodaj: open ? MEMBERS_ADD_OPEN : undefined }),
        replace: options?.replace ?? !open,
      });
    },
    [navigate],
  );
  const list = useMemberList(search, write);
  const create = useMemberCreate(search.dodaj === MEMBERS_ADD_OPEN, writeAdding);
  const { refusal, loading } = list;

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      <PageHeader>
        <div className="min-w-0">
          {/* FOCUSABLE BY SCRIPT ONLY: where focus lands when the dialog
              closes after a deep link, with no button that opened it. */}
          <PageTitle asChild>
            <h1 id={MEMBERS_PAGE_HEADING_ID} tabIndex={-1}>
              {t('nav.ljudi')}
            </h1>
          </PageTitle>
          <PageDescription>{t('ljudi.lede')}</PageDescription>
        </div>
        <PageActions>
          {/* STORY 1.7a: the teams screen, reached from here rather than from
              the navigation, so the destinations stay eight. */}
          <Button asChild variant="outline" className="h-11">
            <Link to="/ljudi/smjene">
              <UsersRound aria-hidden />
              {t('smjene.heading')}
            </Link>
          </Button>
          {/* THE WAY IN, a BUTTON (story 7.13b): adding a person is a dialog
              on this list, not a screen. It is where focus returns on close. */}
          <Button ref={create.opener} type="button" className="h-11" onClick={create.open}>
            <Plus aria-hidden />
            {t('ljudi.form.add')}
          </Button>
        </PageActions>
      </PageHeader>
      {/* OUTSIDE the answered branch, and conditional on both sides: a read that
          produced no row never renders a table, so an explanation rendered
          inside one would be exactly the element nobody can see. `role="alert"`
          announces it on insertion, and the controls point at it by id. */}
      {refusal === null ? null : (
        <Notice id={MEMBERS_ERROR_ID} role="alert">
          {t(membersMessageKey(refusal))}
        </Notice>
      )}
      <MemberTable list={list} />
      <MemberAddDialog create={create} />
    </main>
  );
}

export const ljudiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi',
  // THE FILTERS AND THE DIALOG, each parsed by its own rule: an unknown value
  // of either is dropped.
  validateSearch: (search: Record<string, unknown>): LjudiSearch => ({
    ...membersSearchOf(search),
    ...membersAddSearchOf(search),
  }),
  /**
   * The role guard, and the first one in the tree.
   *
   * THE READER ARRIVES THROUGH THE ROUTER CONTEXT, as `currentSession` does: it
   * makes both branches executable from the node suite (`router.test.ts`), and
   * keeps a `supabaseClient()` call — which throws on a fresh clone with no
   * `.env.local` — out of this block. The role is read outside the query cache,
   * because `beforeLoad` runs before the chrome's entry is reliably warm.
   *
   * IT FORWARDS, IT DOES NOT REFUSE: a member who types this URL is sent to the
   * first destination with `replace: true`, so Back is not a loop.
   */
  beforeLoad: async ({ context }) => {
    // THREE OUTCOMES, and the third is why the read is wrapped: the reader can
    // still REJECT, and an escaping rejection is a blank page at HTTP 200.
    // FAILING CLOSED, and not silently.
    let outcome: MemberRoleOutcome;

    try {
      outcome = await context.currentMemberRole();
    } catch (cause) {
      console.error(MEMBER_ROLE_UNAVAILABLE, cause);

      outcome = { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
    }

    if (mayReadMembers(outcome)) return;

    throw redirect({ to: FIRST_DESTINATION.path, replace: true });
  },
  component: LjudiScreen,
});
