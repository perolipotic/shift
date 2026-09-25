import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { formatMinuteOfDay } from '@/i18n/format';
import { t } from '@/i18n';
import { NO_TEXT, mayReadMembers, shownDate } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { appLayoutRoute } from '@/routes/_app';
import {
  SHIFT_TYPES_LIST_KEY,
  SHIFT_TYPES_READ_TABLE,
  SHIFT_TYPES_TABLE,
  SHIFT_TYPE_VERSIONS_TABLE,
  durationValuesOf,
  shiftTypeDisplayRowOf,
  shiftTypeDurationMessageKey,
  shiftTypeHeadingMessageKey,
  shiftTypesMessageKey,
  shiftTypesQueryOptions,
  shiftTypesSurfaceStateOf,
  shiftTypesTodayOf,
  type ShiftTimesShown,
  type ShiftTypeDisplayRow,
  type ShiftTypeRow,
} from '@/shift-types/list';
import {
  ARCHIVE_ARMED,
  ARCHIVE_BUSY,
  SHIFT_TYPE_ARCHIVED,
  SHIFT_TYPE_CHANGE_SCHEDULED,
  SHIFT_TYPE_DATE_FIELD,
  SHIFT_TYPE_END_FIELD,
  SHIFT_TYPE_NAME_FIELD,
  SHIFT_TYPE_RENAMED,
  SHIFT_TYPE_START_FIELD,
  SHIFT_TYPE_TIMES_CANCELLED,
  SHIFT_TYPE_TIMES_SAVED,
  SHIFT_TYPE_WRITE_UNAVAILABLE,
  TIMES_CANCEL,
  TIMES_SET,
  archiveOfferedOf,
  archiveShiftType,
  archiveStageOf,
  cancelScheduledTimes,
  correctShiftTypeTimes,
  focusesConfirmation,
  marksField,
  refusedFieldOf,
  renameShiftType,
  savesAfter,
  shiftTypeFormKey,
  shiftTypeFormStateOf,
  shiftTypeSavedMessageKey,
  shiftTypeWriteMessageKey,
  timesFormKey,
  timesOfferOf,
  type TimesOffer,
  type ShiftTypeSaved,
  type ShiftTypeVersionWriteTable,
  type ShiftTypeWriteFailure,
  type ShiftTypeWriteTable,
} from '@/shift-types/write';
import { supabaseClient } from '@/supabase/client';

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
 * `is_working` IS NEVER OFFERED: it is fixed at creation. There is no delete;
 * archiving takes one neutral confirmation naming the type, and is refused
 * while a correction is scheduled — the refusal says to cancel it first.
 *
 * THREE REFUSAL REGIONS, each where its write happened: the rename's above the
 * form, the times' in the times block, the archive's in the archive block.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function PostavkeRotacijeTipSmjeneScreen() {
  const { id } = postavkeRotacijeTipSmjeneRoute.useParams();

  return <ShiftTypeScreen key={id} id={id} />;
}

function ShiftTypeScreen({ id }: { readonly id: string }) {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const endField = useRef<HTMLInputElement>(null);
  /** The confirmation, where focus goes when the pressed control unmounts. */
  const confirmation = useRef<HTMLParagraphElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  /** The RENAME's refusal: the one the name field is described by. */
  const [failure, setFailure] = useState<ShiftTypeWriteFailure | null>(null);
  /** The TIMES block's refusal. */
  const [timesFailure, setTimesFailure] = useState<ShiftTypeWriteFailure | null>(null);
  /** The ARCHIVE's refusal, announced inside the archive block. */
  const [archiveFailure, setArchiveFailure] = useState<ShiftTypeWriteFailure | null>(null);
  const [saved, setSaved] = useState<ShiftTypeSaved | null>(null);
  /** Landed renames; the form key counts them, never the name. */
  const [saves, setSaves] = useState(0);

  const answer = useQuery(
    shiftTypesQueryOptions(() => supabaseClient().from(SHIFT_TYPES_READ_TABLE)),
  );

  const readState = shiftTypesSurfaceStateOf(answer);
  const { snapshot, refusal: readRefusal, loading } = readState;
  // A read failure hides the form, decided in `shiftTypeFormStateOf`.
  const form = shiftTypeFormStateOf(readState, id);
  const refusal = failure ?? form.refusal;
  const today = snapshot === null ? null : shiftTypesTodayOf(snapshot, new Date());
  const row = snapshot === null || today === null ? null : shiftTypeDisplayRowOf(snapshot, id, today);
  const stage = archiveStageOf(armed, pending);

  /** Re-read the one list, so both screens show what the database holds now. */
  async function refresh(): Promise<void> {
    try {
      await queryClient.invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY });
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
    }
  }

  function clearOutcomes(): void {
    setFailure(null);
    setTimesFailure(null);
    setArchiveFailure(null);
    setSaved(null);
  }

  /** Rename. Uncontrolled, and keyed by landed renames only. */
  async function submit(event: FormEvent<HTMLFormElement>, type: ShiftTypeRow): Promise<void> {
    event.preventDefault();

    const name = nameField.current;

    if (name === null || writing.current) return;

    writing.current = true;
    // A rename is a different decision from the archive it may interrupt.
    setArmed(false);
    clearOutcomes();
    setPending(true);

    try {
      const outcome = await renameShiftType(
        supabaseClient().from(SHIFT_TYPES_TABLE) as unknown as ShiftTypeWriteTable,
        type,
        name.value,
      );

      if (!outcome.ok) {
        setFailure(outcome.code);
        name.focus();
      } else {
        setSaved(SHIFT_TYPE_RENAMED);
      }

      await refresh();
      // AFTER the re-read, so a remount shows what the database now holds.
      setSaves((current) => savesAfter(current, outcome));
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      setFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * Correct (or first set) the times from the chosen date. The block is keyed
   * by the type's version history, so a landed version returns the date to
   * the new minimum and a refusal keeps every entered value.
   */
  async function saveTimes(event: FormEvent<HTMLFormElement>, type: ShiftTypeRow): Promise<void> {
    event.preventDefault();

    const date = dateField.current;
    const start = startField.current;
    const end = endField.current;

    if (date === null || start === null || end === null || today === null || writing.current) {
      return;
    }

    writing.current = true;
    setArmed(false);
    clearOutcomes();
    setPending(true);

    try {
      const outcome = await correctShiftTypeTimes(
        supabaseClient().from(SHIFT_TYPE_VERSIONS_TABLE) as unknown as ShiftTypeVersionWriteTable,
        type,
        { date: date.value, start: start.value, end: end.value },
        today,
      );

      if (!outcome.ok) {
        setTimesFailure(outcome.code);

        const field = refusedFieldOf(outcome.code, SHIFT_TYPE_DATE_FIELD);

        (field === SHIFT_TYPE_START_FIELD ? start : date).focus();
      } else {
        setSaved(SHIFT_TYPE_TIMES_SAVED);
      }

      await refresh();
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      setTimesFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /** Cancel the scheduled correction; the correction is offered again after. */
  async function cancelTimes(type: ShiftTypeRow): Promise<void> {
    if (today === null || writing.current) return;

    writing.current = true;
    setArmed(false);
    clearOutcomes();
    setPending(true);

    try {
      const outcome = await cancelScheduledTimes(
        supabaseClient().from(SHIFT_TYPE_VERSIONS_TABLE) as unknown as ShiftTypeVersionWriteTable,
        type,
        today,
      );

      const landed = outcome.ok ? SHIFT_TYPE_TIMES_CANCELLED : null;

      if (!outcome.ok) setTimesFailure(outcome.code);
      setSaved(landed);

      await refresh();

      // The cancel button unmounts with the scheduled change; focus follows
      // the confirmation rather than falling to the document.
      if (focusesConfirmation(landed)) confirmation.current?.focus();
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      setTimesFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * Archive, once confirmed. The confirmation stays mounted and disabled while
   * the write is outstanding, and is disarmed only in the `finally`.
   */
  async function archive(type: ShiftTypeRow): Promise<void> {
    if (today === null || writing.current) return;

    writing.current = true;
    clearOutcomes();
    setPending(true);

    try {
      const outcome = await archiveShiftType(
        supabaseClient().from(SHIFT_TYPES_TABLE) as unknown as ShiftTypeWriteTable,
        type,
        today,
      );
      const landed = outcome.ok ? SHIFT_TYPE_ARCHIVED : null;

      if (!outcome.ok) setArchiveFailure(outcome.code);
      setSaved(landed);

      await refresh();

      // The confirm button unmounts once the type reads as archived; focus
      // follows the confirmation rather than falling to the document.
      if (focusesConfirmation(landed)) confirmation.current?.focus();
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      setArchiveFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
      setArmed(false);
    }
  }

  function durationOf(times: ShiftTimesShown): string {
    return t(shiftTypeDurationMessageKey(times.durationMinutes), durationValuesOf(times.durationMinutes));
  }

  /** The times in effect today: none for a non-working type, and none yet for a working one without a version. */
  function renderCurrent(shown: ShiftTypeDisplayRow): ReactNode {
    if (!shown.type.isWorking) {
      return <Badge variant="secondary">{t('rotation.shiftTypes.nonworking')}</Badge>;
    }

    if (shown.times === null) {
      return <p className="text-muted-foreground">{t('rotation.shiftTypes.noTimes')}</p>;
    }

    return (
      <dl className="flex flex-wrap gap-x-4 gap-y-1">
        <div className="flex gap-1">
          <dt className="text-muted-foreground">{t('rotation.shiftTypes.times')}</dt>
          <dd className="tabular-nums">{shown.times.range}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">{t('rotation.shiftTypes.duration.label')}</dt>
          <dd className="tabular-nums">{durationOf(shown.times)}</dd>
        </div>
      </dl>
    );
  }

  /** The chip, the times in effect today, and the scheduled correction, read-only. */
  function renderFacts(shown: ShiftTypeDisplayRow): ReactNode {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {/* THE CHIP: the slot's colour, and ALWAYS the name as text. */}
        <span className={shown.chipClass}>
          <span className="truncate">{shown.type.name}</span>
        </span>
        {renderCurrent(shown)}
        {/* A pill whose TEXT is the meaning; no status colour. */}
        {shown.times?.crossesMidnight === true ? (
          <Badge variant="secondary">{t('rotation.shiftTypes.crossesMidnight')}</Badge>
        ) : null}
        {shown.scheduled === null ? null : (
          <p className="basis-full tabular-nums">
            {t('rotation.shiftTypes.scheduled', {
              date: shownDate(shown.scheduled.from),
              range: shown.scheduled.times.range,
              duration: durationOf(shown.scheduled.times),
            })}
          </p>
        )}
      </div>
    );
  }

  function renderTimesRefusal(): ReactNode {
    return timesFailure === null ? null : (
      <Notice id="shift-type-times-error" role="alert">
        {t(shiftTypeWriteMessageKey(timesFailure))}
      </Notice>
    );
  }

  function renderArchiveRefusal(): ReactNode {
    return archiveFailure === null ? null : (
      <Notice role="alert">{t(shiftTypeWriteMessageKey(archiveFailure))}</Notice>
    );
  }

  function renderArchive(type: ShiftTypeRow): ReactNode {
    // NOT OFFERED WHILE A CORRECTION IS SCHEDULED: `0013` refuses it, so the
    // screen says what to do instead of arming a write that can only fail.
    if (today !== null && !archiveOfferedOf(type, today)) {
      return (
        <p className="text-sm text-muted-foreground">
          {t(shiftTypeWriteMessageKey(SHIFT_TYPE_CHANGE_SCHEDULED))}
        </p>
      );
    }

    if (stage === ARCHIVE_ARMED || stage === ARCHIVE_BUSY) {
      const busy = stage === ARCHIVE_BUSY;

      return (
        <div className="grid gap-2">
          <p className="text-sm font-medium">
            {t('rotation.shiftTypes.archivePrompt', { name: type.name })}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              className="h-11 w-full"
              type="button"
              variant="outline"
              disabled={busy}
              aria-busy={busy}
              onClick={() => {
                void archive(type);
              }}
            >
              <span className="truncate">
                {t('rotation.shiftTypes.archiveConfirm', { name: type.name })}
              </span>
            </Button>
            <Button
              className="h-11 w-full"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setArmed(false);
              }}
            >
              <span className="truncate">{t('rotation.shiftTypes.archiveCancel')}</span>
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-2">
        {renderArchiveRefusal()}
        <Button
          className="h-11 w-full"
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setArchiveFailure(null);
            setSaved(null);
            setArmed(true);
          }}
        >
          <span className="truncate">
            {t('rotation.shiftTypes.archive', { name: type.name })}
          </span>
        </Button>
      </div>
    );
  }

  function renderType(type: ShiftTypeRow): ReactNode {
    const shown = row;

    if (shown === null) return null;

    // AN ARCHIVED TYPE is frozen: its facts and a note, and nothing that writes.
    if (type.archived) {
      return (
        <div className="grid gap-2">
          {/* A refusal set just before the re-read revealed the type as
              archived is still said here, where the blocks it belonged to
              no longer render. */}
          {renderTimesRefusal()}
          {renderArchiveRefusal()}
          {renderFacts(shown)}
          <p className="text-sm text-muted-foreground">{t('rotation.shiftTypes.archivedNote')}</p>
        </div>
      );
    }

    return (
      <div className="grid gap-6">
        {renderFacts(shown)}
        <form
          key={shiftTypeFormKey(type, saves)}
          method="post"
          onSubmit={(event) => {
            void submit(event, type);
          }}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="shift-type-name">{t('rotation.shiftTypes.name')}</Label>
            <Input
              ref={nameField}
              id="shift-type-name"
              name="name"
              type="text"
              required
              defaultValue={type.name}
              onChange={() => {
                // A confirmation describes the last save, not what is typed now.
                setSaved(null);
              }}
              aria-invalid={marksField(failure, SHIFT_TYPE_NAME_FIELD)}
              aria-describedby={failure === null ? undefined : 'shift-type-form-error'}
              className="h-11"
            />
          </div>
          <Button className="h-11 w-full" type="submit" disabled={pending} aria-busy={pending}>
            {t('rotation.shiftTypes.save')}
          </Button>
        </form>
        {renderTimes(type, shown)}
        {renderArchive(type)}
      </div>
    );
  }

  function renderBody(): ReactNode {
    if (form.type !== null) return renderType(form.type);

    return loading ? <div className="h-11 w-full animate-pulse rounded-md bg-muted" /> : null;
  }

  /** The times form: from a date, a start and an end. */
  function renderTimesForm(
    type: ShiftTypeRow,
    offer: Exclude<TimesOffer, { readonly kind: typeof TIMES_CANCEL }>,
    current: ShiftTimesShown | null,
  ): ReactNode {
    return (
      <form
        key={timesFormKey(type)}
        method="post"
        onSubmit={(event) => {
          void saveTimes(event, type);
        }}
        className="grid gap-4"
      >
        <div className="grid gap-2">
          <Label htmlFor="shift-type-times-date">{t('rotation.shiftTypes.timesFrom')}</Label>
          <Input
            ref={dateField}
            id="shift-type-times-date"
            name="effectiveFrom"
            type="date"
            required
            min={offer.minimum}
            defaultValue={offer.minimum}
            onChange={() => {
              setSaved(null);
            }}
            aria-invalid={marksField(timesFailure, SHIFT_TYPE_DATE_FIELD)}
            aria-describedby={timesFailure === null ? undefined : 'shift-type-times-error'}
            className="h-11"
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="grid min-w-0 flex-1 basis-32 gap-2">
            <Label htmlFor="shift-type-times-start">{t('rotation.shiftTypes.start')}</Label>
            <Input
              ref={startField}
              id="shift-type-times-start"
              name="start"
              type="time"
              required
              defaultValue={current === null ? NO_TEXT : formatMinuteOfDay(current.startMinute)}
              onChange={() => {
                setSaved(null);
              }}
              aria-invalid={marksField(timesFailure, SHIFT_TYPE_START_FIELD)}
              aria-describedby={timesFailure === null ? undefined : 'shift-type-times-error'}
              className="h-11 w-full"
            />
          </div>
          <div className="grid min-w-0 flex-1 basis-32 gap-2">
            <Label htmlFor="shift-type-times-end">{t('rotation.shiftTypes.end')}</Label>
            <Input
              ref={endField}
              id="shift-type-times-end"
              name="end"
              type="time"
              required
              defaultValue={current === null ? NO_TEXT : formatMinuteOfDay(current.endMinute)}
              onChange={() => {
                setSaved(null);
              }}
              aria-invalid={marksField(timesFailure, SHIFT_TYPE_END_FIELD)}
              aria-describedby={timesFailure === null ? undefined : 'shift-type-times-error'}
              className="h-11 w-full"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t('rotation.shiftTypes.timesNote')}</p>
        <Button className="h-11 w-full" type="submit" disabled={pending} aria-busy={pending}>
          <span className="truncate">
            {offer.kind === TIMES_SET
              ? t('rotation.shiftTypes.timesSet')
              : t('rotation.shiftTypes.timesCorrect')}
          </span>
        </Button>
      </form>
    );
  }

  /** The times block: set or correct from a date, or cancel what is scheduled. */
  function renderTimes(type: ShiftTypeRow, shown: ShiftTypeDisplayRow): ReactNode {
    if (today === null) return null;

    const offer = timesOfferOf(type, today);

    if (offer === null) return null;

    return (
      <section className="grid gap-4">
        <h2 className="text-base font-bold">{t('rotation.shiftTypes.timesHeading')}</h2>
        {renderTimesRefusal()}
        {offer.kind === TIMES_CANCEL ? (
          <Button
            className="h-11 w-full"
            type="button"
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            onClick={() => {
              void cancelTimes(type);
            }}
          >
            <span className="truncate">{t('rotation.shiftTypes.cancelScheduled')}</span>
          </Button>
        ) : (
          renderTimesForm(type, offer, shown.times)
        )}
      </section>
    );
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      <PageHeader>
        <PageTitle asChild>
          <h1>{t(shiftTypeHeadingMessageKey(form.type))}</h1>
        </PageTitle>
      </PageHeader>
      <Card className="w-full min-w-0 max-w-lg">
        <CardContent className="grid gap-6">
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
          {renderBody()}
          <Button asChild className="h-11 w-full" variant="outline">
            <Link to="/postavke-rotacije">
              <span className="truncate">{t('rotation.shiftTypes.back')}</span>
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
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
