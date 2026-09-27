import { createRoute, redirect } from '@tanstack/react-router';

import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';
import { PostavkeRotacijeScreen } from '@/pages/postavke-rotacije';
import { ShiftTypeEditBody } from '@/features/shift-types/components/shift-type-edit-body';
import { useShiftTypeEdit } from '@/features/shift-types/hooks/use-shift-type-edit';
import { shiftTypeHeadingMessageKey, shiftTypesMessageKey } from '@/features/shift-types/services/list';
import { shiftTypeSavedMessageKey, shiftTypeWriteMessageKey } from '@/features/shift-types/services/write';

/**
 * `/postavke-rotacije/tipovi-smjena/$id` — one shift type: rename it, correct
 * its times from a chosen date, cancel a scheduled correction, or archive it
 * (story 2.2b).
 *
 * THE SAME ONE READ the list screen makes, under the same key, so the two
 * screens can never show two versions of a type. KEYED BY THE ROUTE'S ID, as
 * `/ljudi/smjene/$id` is, so nothing armed or announced for one type is
 * carried to another.
 *
 * A RENAME IS CURRENT-STATE and takes effect on every date; a TIME CORRECTION
 * IS VERSIONED (AD-2): it takes effect from its date, and every earlier date
 * keeps the times it had. While a correction is scheduled it is shown with its
 * date and offered for cancellation only.
 *
 * THE KIND IS NEVER OFFERED: it is fixed at creation. There is no delete;
 * archiving takes one neutral confirmation naming the type, and is refused
 * while a correction is scheduled — the refusal says to cancel it first.
 *
 * THREE REFUSAL REGIONS, each where its write happened: the rename's above the
 * form, the times' in the times block, the archive's in the archive block.
 *
 * A DIALOG OVER THE LIST (design refresh C), as the hour band editor is: the
 * route renders `Postavke rotacije` and opens this type above it, every way
 * the dialog closes navigates back, and the archive's confirmation replaces
 * the dialog's content rather than opening a second one.
 *
 * THIS FILE COMPOSES (source structure B4). The state, the one read and the
 * four writes are `useShiftTypeEdit`; the dialog's body is components in
 * `@/features/shift-types/components`; every rule is in
 * `@/features/shift-types/services/list` and
 * `@/features/shift-types/services/write`, which the node suite executes.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function PostavkeRotacijeTipSmjeneScreen() {
  const { id } = postavkeRotacijeTipSmjeneRoute.useParams();

  return <ShiftTypeScreen key={id} id={id} />;
}

function ShiftTypeScreen({ id }: { readonly id: string }) {
  const screen = useShiftTypeEdit(id);
  const { close, form, readRefusal, refusal, saved, confirmation } = screen;

  return (
    <>
      {/* THE LIST, behind the dialog: the type is edited where it is listed. */}
      <PostavkeRotacijeScreen />
      <Dialog
        open={true}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        aria-labelledby="shift-type-edit-heading"
        className="max-w-xl"
      >
        <DialogHeader closeLabel={t('rotation.shiftTypes.close')} onClose={close}>
          <DialogTitle id="shift-type-edit-heading">{t(shiftTypeHeadingMessageKey(form.type))}</DialogTitle>
        </DialogHeader>
        {readRefusal === null ? null : (
          <Notice role="alert">{t(shiftTypesMessageKey(readRefusal))}</Notice>
        )}
        {refusal === null ? null : (
          <Notice id="shift-type-form-error" role="alert">
            {t(shiftTypeWriteMessageKey(refusal))}
          </Notice>
        )}
        {saved === null ? null : (
          <Notice ref={confirmation} tabIndex={-1} role="status">
            {t(shiftTypeSavedMessageKey(saved))}
          </Notice>
        )}
        <ShiftTypeEditBody screen={screen} />
      </Dialog>
    </>
  );
}

export const postavkeRotacijeTipSmjeneRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/postavke-rotacije/tipovi-smjena/$id',
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
  component: PostavkeRotacijeTipSmjeneScreen,
});
