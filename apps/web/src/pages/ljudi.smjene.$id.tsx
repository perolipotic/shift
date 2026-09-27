import { createRoute, redirect } from '@tanstack/react-router';

import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { TeamEditBody } from '@/features/teams/components/team-edit-body';
import { useTeamEdit } from '@/features/teams/hooks/use-team-edit';
import { teamHeadingMessageKey, teamsMessageKey } from '@/features/teams/services/list';
import { teamSavedMessageKey, teamWriteMessageKey } from '@/features/teams/services/write';
import { t } from '@/lib/i18n';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';
import { LjudiSmjeneScreen } from '@/pages/ljudi.smjene';

/**
 * `/ljudi/smjene/$id` — rename or archive one team, or view an archived one
 * (story 1.7a).
 *
 * THE SAME ONE READ the list screen makes, under the same key: the team is
 * found in that answer, so the two screens can never show two versions of it.
 *
 * KEYED BY THE ROUTE'S ID. Moving from one team to another keeps this route
 * mounted, and an armed confirmation, a refusal or a confirmation carried over
 * would describe the wrong team — so the screen below is remounted per id and
 * starts clean.
 *
 * ARCHIVING IS ONE-WAY and takes ONE CONFIRMATION naming the team, in neutral
 * styling: it removes nothing, so it is not dressed as a destructive action. An
 * archived team renders its name and a note, and no control that writes.
 *
 * A DIALOG OVER THE LIST (design refresh C), as the hour band editor is: the
 * route renders `Smjene` and opens this team above it, every way the dialog
 * closes navigates back, and the archive's confirmation replaces the form
 * inside it.
 *
 * TWO REFUSALS, EACH WHERE IT HAPPENED. A refused rename is announced above the
 * form and is what the name field is described by; a refused archive is
 * announced inside the archive block, and never marks the name field invalid.
 *
 * THIS FILE COMPOSES (source structure B6). The state, the one read and the
 * two writes are `useTeamEdit`; the dialog's body is components in
 * `@/features/teams/components`; every rule is in
 * `@/features/teams/services/list` and `@/features/teams/services/write`,
 * which the node suite executes.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function LjudiSmjenaScreen() {
  const { id } = ljudiSmjenaRoute.useParams();

  return <TeamScreen key={id} id={id} />;
}

function TeamScreen({ id }: { readonly id: string }) {
  const screen = useTeamEdit(id);
  const { close, form, readRefusal, refusal, saved } = screen;

  return (
    <>
      {/* THE LIST, behind the dialog: the team is edited where it is listed. */}
      <LjudiSmjeneScreen />
      <Dialog
        open={true}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        aria-labelledby="team-edit-heading"
      >
        <DialogHeader closeLabel={t('smjene.close')} onClose={close}>
          <DialogTitle id="team-edit-heading">{t(teamHeadingMessageKey(form.team))}</DialogTitle>
        </DialogHeader>
        {readRefusal === null ? null : (
          <Notice role="alert">
            {t(teamsMessageKey(readRefusal))}
          </Notice>
        )}
        {refusal === null ? null : (
          <Notice id="team-form-error" role="alert">
            {t(teamWriteMessageKey(refusal))}
          </Notice>
        )}
        {saved === null ? null : (
          <Notice role="status">
            {t(teamSavedMessageKey(saved))}
          </Notice>
        )}
        <TeamEditBody screen={screen} />
      </Dialog>
    </>
  );
}

export const ljudiSmjenaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/smjene/$id',
  /** The guard `/ljudi` carries, copied verbatim; `router.test.ts` drives it. */
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
  component: LjudiSmjenaScreen,
});
