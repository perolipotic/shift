import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { MoveRight, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { OutputField } from '@/components/ui/output-field';
import {
  HOUR_BANDS_LIST_KEY,
  HOUR_BANDS_TABLE,
  durationMessageKey,
  durationValuesOf,
  hourBandPreviewOf,
  hourBandsMessageKey,
  hourBandsSurfaceStateOf,
  hourBandsQueryOptions,
  type HourBandRow,
} from '@/hour-bands/list';
import {
  HOUR_BAND_NAME_FIELD,
  HOUR_BAND_REMOVED,
  HOUR_BAND_SAVED,
  HOUR_BAND_START_FIELD,
  HOUR_BAND_WRITE_UNAVAILABLE,
  REMOVE_ARMED,
  REMOVE_BUSY,
  hourBandFormKey,
  hourBandFormStateOf,
  hourBandSavedMessageKey,
  hourBandWriteMessageKey,
  holdsRemovalOutcome,
  marksField,
  refusedFieldOf,
  removeHourBand,
  removeStageOf,
  savesAfter,
  updateHourBand,
  type HourBandSaved,
  type HourBandWriteFailure,
  type HourBandWriteTable,
} from '@/hour-bands/write';
import { formatMinuteOfDay } from '@/i18n/format';
import { t } from '@/i18n';
import { mayReadMembers } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { appLayoutRoute } from '@/routes/_app';
import { OrganizacijaSatniPojasiScreen } from '@/routes/organizacija.satni-pojasi';
import { supabaseClient } from '@/supabase/client';

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
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function OrganizacijaSatniPojasScreen() {
  const { id } = organizacijaSatniPojasRoute.useParams();

  return <HourBandScreen key={id} id={id} />;
}

function HourBandScreen({ id }: { readonly id: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nameField = useRef<HTMLInputElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  /** The SAVE's refusal: the one the fields are described by. */
  const [failure, setFailure] = useState<HourBandWriteFailure | null>(null);
  /** The REMOVAL's refusal, announced inside the removal block. */
  const [removeFailure, setRemoveFailure] = useState<HourBandWriteFailure | null>(null);
  const [saved, setSaved] = useState<HourBandSaved | null>(null);
  /** Landed saves; the form key counts them, never the values. */
  const [saves, setSaves] = useState(0);
  /** The start as typed since the form last mounted, or `null` for the stored one. */
  const [typedStart, setTypedStart] = useState<string | null>(null);

  const answer = useQuery(hourBandsQueryOptions(() => supabaseClient().from(HOUR_BANDS_TABLE)));

  const readState = hourBandsSurfaceStateOf(answer);
  const { bands, refusal: readRefusal, loading } = readState;
  // A read failure hides the form, decided in `hourBandFormStateOf` from the state.
  const form = hourBandFormStateOf(readState, id, holdsRemovalOutcome(saved, removeFailure));
  const refusal = failure ?? form.refusal;
  const stage = removeStageOf(armed, pending);
  /** The removal is being asked about, or is in flight. */
  const confirming = stage === REMOVE_ARMED || stage === REMOVE_BUSY;
  const preview =
    bands === null || form.band === null
      ? null
      : hourBandPreviewOf(bands, typedStart ?? formatMinuteOfDay(form.band.startMinute), id);

  function close(): void {
    void navigate({ to: '/organizacija/satni-pojasi' });
  }

  /** Re-read the one list, so both screens show what the database holds now. */
  async function refresh(): Promise<void> {
    try {
      await queryClient.invalidateQueries({ queryKey: HOUR_BANDS_LIST_KEY });
    } catch (cause) {
      console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * Save the name and start. Both fields are uncontrolled and the form is keyed
   * by landed saves only, so a refused save keeps what was typed even when the
   * re-read brings a band changed elsewhere.
   */
  async function submit(event: FormEvent<HTMLFormElement>, band: HourBandRow): Promise<void> {
    event.preventDefault();

    const name = nameField.current;
    const start = startField.current;

    if (name === null || start === null || writing.current) return;

    writing.current = true;
    // A save is a different decision from the removal it may interrupt.
    setArmed(false);
    setFailure(null);
    setRemoveFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const outcome = await updateHourBand(
        supabaseClient().from(HOUR_BANDS_TABLE) as unknown as HourBandWriteTable,
        band,
        name.value,
        start.value,
      );

      if (!outcome.ok) {
        setFailure(outcome.code);
        (refusedFieldOf(outcome.code) === HOUR_BAND_START_FIELD ? start : name).focus();
      } else {
        setSaved(HOUR_BAND_SAVED);
      }

      await refresh();
      // AFTER the re-read, so a remount shows what the database now holds.
      setSaves((current) => savesAfter(current, outcome));
      if (outcome.ok) setTypedStart(null);
    } catch (cause) {
      console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      setFailure(HOUR_BAND_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * Remove, once confirmed. The confirmation stays mounted and disabled while
   * the write is outstanding, and is disarmed only in the `finally`.
   */
  async function remove(band: HourBandRow): Promise<void> {
    if (writing.current) return;

    writing.current = true;
    setFailure(null);
    setRemoveFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const outcome = await removeHourBand(
        supabaseClient().from(HOUR_BANDS_TABLE) as unknown as HourBandWriteTable,
        band,
      );

      if (!outcome.ok) {
        setRemoveFailure(outcome.code);
      } else {
        setSaved(HOUR_BAND_REMOVED);
      }

      await refresh();

      // The confirm button this press came from is gone with the band, so
      // focus would fall to the document. The dialog's close is where a
      // person goes next, and it is always rendered.
      if (outcome.ok) closeButton.current?.focus();
    } catch (cause) {
      console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      setRemoveFailure(HOUR_BAND_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
      setArmed(false);
    }
  }

  function renderRemoveRefusal(): ReactNode {
    return removeFailure === null ? null : (
      <Notice role="alert">{t(hourBandWriteMessageKey(removeFailure))}</Notice>
    );
  }

  /** The removal offer, beside Save in the dialog's footer. */
  function renderRemove(band: HourBandRow): ReactNode {
    return (
      <Button
        className="h-11"
        type="button"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setRemoveFailure(null);
          setSaved(null);
          setArmed(true);
        }}
      >
        <Trash2 aria-hidden />
        {/* THE WORD IS SHORT, THE NAME IS WHOLE: sighted people read the
            band's name in the field above, and the accessible name still
            names it — and begins with the visible word (WCAG 2.5.3). */}
        <span aria-hidden>{t('organization.hourBands.removeShort')}</span>
        <span className="sr-only">{t('organization.hourBands.remove', { name: band.name })}</span>
      </Button>
    );
  }

  /**
   * THE CONFIRMATION, in place of the form inside the same dialog: one question
   * naming the band, and the two answers side by side. It stays mounted and
   * disabled while the removal is outstanding.
   */
  function renderConfirm(band: HourBandRow): ReactNode {
    const busy = stage === REMOVE_BUSY;

    return (
      <div className="grid gap-5">
        <p className="text-sm font-medium">
          {t('organization.hourBands.removePrompt', { name: band.name })}
        </p>
        <DialogFooter>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setArmed(false);
            }}
          >
            <span className="truncate">{t('organization.hourBands.removeCancel')}</span>
          </Button>
          <Button
            className="h-11"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void remove(band);
            }}
          >
            <Trash2 aria-hidden />
            <span className="truncate">
              {t('organization.hourBands.removeConfirm', { name: band.name })}
            </span>
          </Button>
        </DialogFooter>
      </div>
    );
  }

  /**
   * The end the start gives, computed and read-only, and the duration and
   * midnight flag that follow from it. From the start AS TYPED, so a changed
   * start shows its new end before it is saved.
   */
  function renderEnd(): ReactNode {
    return (
      <div className="grid gap-2">
        <Label htmlFor="hour-band-end">{t('organization.hourBands.end')}</Label>
        <OutputField id="hour-band-end" htmlFor="hour-band-start">
          <MoveRight aria-hidden />
          {preview === null ? t('organization.hourBands.endPending') : preview.end}
        </OutputField>
      </div>
    );
  }

  function renderDuration(): ReactNode {
    if (preview === null) return null;

    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('organization.hourBands.duration.label')}</span>
        <span className="font-semibold tabular-nums">
          {t(durationMessageKey(preview.durationMinutes), durationValuesOf(preview.durationMinutes))}
        </span>
        {/* A pill whose TEXT is the meaning; no status colour. */}
        {preview.crossesMidnight ? (
          <Badge variant="outline">{t('organization.hourBands.crossesMidnight')}</Badge>
        ) : null}
      </div>
    );
  }

  function renderBand(band: HourBandRow): ReactNode {
    return (
      <>
        {/* HIDDEN, NOT UNMOUNTED, while the removal is asked about: a
            cancelled removal returns to the form with what was typed. */}
        <form
          key={hourBandFormKey(band, saves)}
          method="post"
          onSubmit={(event) => {
            void submit(event, band);
          }}
          className={confirming ? 'hidden' : 'grid gap-5'}
        >
          <div className="grid gap-2">
            <Label htmlFor="hour-band-name">{t('organization.hourBands.name')}</Label>
            <Input
              ref={nameField}
              id="hour-band-name"
              name="name"
              type="text"
              required
              defaultValue={band.name}
              onChange={() => {
                // A confirmation describes the last save, not what is typed now.
                setSaved(null);
              }}
              aria-invalid={marksField(failure, HOUR_BAND_NAME_FIELD)}
              aria-describedby={failure === null ? undefined : 'hour-band-form-error'}
              className="h-11"
            />
          </div>
          <div className="grid gap-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="hour-band-start">{t('organization.hourBands.start')}</Label>
                <Input
                  ref={startField}
                  id="hour-band-start"
                  name="start"
                  type="time"
                  required
                  defaultValue={formatMinuteOfDay(band.startMinute)}
                  onChange={(event) => {
                    setSaved(null);
                    setTypedStart(event.currentTarget.value);
                  }}
                  aria-invalid={marksField(failure, HOUR_BAND_START_FIELD)}
                  aria-describedby={failure === null ? 'hour-band-end-hint' : 'hour-band-form-error'}
                  className="h-11"
                />
              </div>
              {renderEnd()}
            </div>
            <p id="hour-band-end-hint" className="text-xs text-muted-foreground">
              {t('organization.hourBands.endHint')}
            </p>
            {renderDuration()}
          </div>
          {/* THE TWO DECISIONS TOGETHER, at the right: remove, then save.
              Neutral, never `destructive`, which UX-DR4 keeps for conflicts;
              the icon and the confirmation that follows carry the weight.
              The dialog's close is the way back. */}
          <DialogFooter>
            {renderRemove(band)}
            <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
              {t('organization.hourBands.save')}
            </Button>
          </DialogFooter>
        </form>
        {confirming ? renderConfirm(band) : null}
      </>
    );
  }

  function renderBody(): ReactNode {
    if (form.band !== null) return renderBand(form.band);

    return loading ? <div className="h-11 w-full animate-pulse rounded-md bg-muted" /> : null;
  }

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
        {renderBody()}
        {/* OUTSIDE the band's block, so a removal refused as stale — the band
            already gone, and gone from the re-read too — still says so. */}
        {renderRemoveRefusal()}
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
