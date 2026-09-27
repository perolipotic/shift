import { createRoute, redirect } from '@tanstack/react-router';

import { PageDescription, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { RotationSection } from '@/features/rotation/components/rotation-section';
import { ShiftTypeAddDialog } from '@/features/shift-types/components/shift-type-add-dialog';
import { ShiftTypeListSection } from '@/features/shift-types/components/shift-type-list-section';
import { useShiftTypeList } from '@/features/shift-types/hooks/use-shift-type-list';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Postavke rotacije` — the organization's shift types (story 2.2b).
 *
 * ADMIN ONLY (UX-DR32), under the guard `/ljudi/smjene` carries. Its first
 * section is `Tipovi smjena`: the types in use, each in its ramp-slot chip with
 * its times and duration, an add form, and the archived types listed
 * separately and read-only. Below it, the rotation builder (story 2.3b,
 * `@/features/rotation/components/rotation-section`), which reads its own snapshot — so a shift
 * type write invalidates `ROTATION_KEY` as well.
 *
 * THE CHIP ALWAYS CARRIES THE NAME AS TEXT; the slot colour only reinforces
 * it, so a seventh working type — slot 1 again — is told apart by its name.
 * The slot, the times, the duration and the midnight flag all come from
 * `@/features/shift-types/services/list`, which reads `@shift/domain`; nothing is computed here.
 *
 * A TABLE AND A DIALOG (design refresh C): the types in a table, the add form
 * in a dialog opened from the header, and each type edited in a dialog over
 * this list by `/postavke-rotacije/tipovi-smjena/$id`.
 *
 * THIS FILE COMPOSES (source structure B4). The state, the one read and the
 * add are `useShiftTypeList`; the section and the dialog are components in
 * `@/features/shift-types/components`; every rule is in
 * `@/features/shift-types/services/list` and
 * `@/features/shift-types/services/write`, which the node suite executes.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function PostavkeRotacijeScreen() {
  const screen = useShiftTypeList();

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={screen.loading}
    >
      {/* THE OWNER LAYOUT (story 2.3b): the page header, with `Spremi
          rotaciju` among its actions, and the four numbered sections are laid
          out by the rotation builder; this screen hands it its title and
          section 1, the shift types. */}
      <RotationSection
        heading={
          <div className="min-w-0">
            <PageTitle asChild>
              <h1>{t('nav.postavkeRotacije')}</h1>
            </PageTitle>
            <PageDescription>{t('rotation.shiftTypes.lede')}</PageDescription>
          </div>
        }
        shiftTypes={<ShiftTypeListSection screen={screen} />}
      />
      <ShiftTypeAddDialog screen={screen} />
    </main>
  );
}

export const postavkeRotacijeRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/postavke-rotacije',
  /** The guard `/ljudi/smjene` carries, copied verbatim; `router.test.ts` drives it. */
  beforeLoad: async ({ context }) => {
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
  component: PostavkeRotacijeScreen,
});
