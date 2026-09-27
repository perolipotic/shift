import { createRoute, redirect } from '@tanstack/react-router';

import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { HourBandEditBody } from '@/features/hour-bands/components/hour-band-edit-body';
import { HourBandRemoveRefusal } from '@/features/hour-bands/components/hour-band-remove';
import { useHourBandEdit } from '@/features/hour-bands/hooks/use-hour-band-edit';
import { hourBandsMessageKey } from '@/features/hour-bands/services/list';
import { hourBandSavedMessageKey, hourBandWriteMessageKey } from '@/features/hour-bands/services/write';
import { t } from '@/lib/i18n';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';
import { OrganizacijaSatniPojasiScreen } from '@/pages/organizacija.satni-pojasi';

/**
 * `/organizacija/satni-pojasi/$id` — edit one hour band's name or start, or
 * remove it (story 2.1b).
 *
 * THE SAME ONE READ the list screen makes, under the same key: the band is
 * found in that answer, so the two screens can never show two versions of it.
 *
 * KEYED BY THE ROUTE'S ID, as `/ljudi/smjene/$id` is: an armed confirmation, a
 * refusal or a confirmation carried from one band to another would describe
 * the wrong band, so the screen below is remounted per id and starts clean.
 *
 * REMOVAL TAKES ONE CONFIRMATION naming the band, in neutral styling. Any band
 * may be removed, the last one included: the day it leaves uncovered is
 * hatched on the list screen's bar, which is where the consequence is stated.
 *
 * A DIALOG OVER THE LIST (design refresh C). The route renders the list screen
 * and opens this band in a modal above it, so a band is edited where it is
 * listed, while the URL still names it: a link opens it, Back closes it, and
 * every way the dialog closes navigates to the list.
 *
 * THE END IS SHOWN BESIDE THE START, computed from the start as typed by
 * `hourBandPreviewOf`, and never entered: a band ends where the next begins.
 *
 * TWO REFUSALS, EACH WHERE IT HAPPENED. A refused save is announced above the
 * form and describes the field it is about; a refused removal is announced
 * below the band, outside its block, and marks no field invalid. Outside,
 * because a removal refused as stale means the band is gone: its block
 * unmounts on the re-read, and the refusal must not unmount with it.
 *
 * THIS FILE COMPOSES (source structure B5). The state, the one read and the
 * two writes are `useHourBandEdit`; the dialog's body is components in
 * `@/features/hour-bands/components`; every rule is in
 * `@/features/hour-bands/services/list` and
 * `@/features/hour-bands/services/write`, which the node suite executes.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function OrganizacijaSatniPojasScreen() {
  const { id } = organizacijaSatniPojasRoute.useParams();

  return <HourBandScreen key={id} id={id} />;
}

function HourBandScreen({ id }: { readonly id: string }) {
  const screen = useHourBandEdit(id);
  const { close, closeButton, readRefusal, refusal, saved, removeFailure } = screen;

  return (
    <>
      {/* THE LIST, behind the dialog: the band is edited where it is listed. */}
      <OrganizacijaSatniPojasiScreen />
      <Dialog
        open={true}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        aria-labelledby="hour-band-edit-heading"
      >
        <DialogHeader
          closeRef={closeButton}
          closeLabel={t('organization.hourBands.close')}
          onClose={close}
        >
          <DialogTitle id="hour-band-edit-heading">{t('organization.hourBands.editHeading')}</DialogTitle>
        </DialogHeader>
        {readRefusal === null ? null : (
          <Notice role="alert">{t(hourBandsMessageKey(readRefusal))}</Notice>
        )}
        {refusal === null ? null : (
          <Notice id="hour-band-form-error" role="alert">
            {t(hourBandWriteMessageKey(refusal))}
          </Notice>
        )}
        {saved === null ? null : (
          <Notice role="status">{t(hourBandSavedMessageKey(saved))}</Notice>
        )}
        <HourBandEditBody screen={screen} />
        {/* OUTSIDE the band's block, so a removal refused as stale — the band
            already gone, and gone from the re-read too — still says so. */}
        <HourBandRemoveRefusal removeFailure={removeFailure} />
      </Dialog>
    </>
  );
}

export const organizacijaSatniPojasRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/organizacija/satni-pojasi/$id',
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
  component: OrganizacijaSatniPojasScreen,
});
