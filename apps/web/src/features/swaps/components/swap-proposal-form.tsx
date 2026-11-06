import { Link } from '@tanstack/react-router';
import { monthOf } from '@shift/domain';
import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { ArrowLeft, PaperPlaneRight } from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { outOptionOf, type RosterLineTranslate } from '@/features/calendar/utils/day-detail';
import { durationMessageKey } from '@/features/hour-bands/services/list';
import { positionsShown } from '@/features/members/utils/position';
import { ranksShown } from '@/features/members/utils/rank';
import type { SwapProposalForm } from '@/features/swaps/hooks/use-swap-proposal';
import {
  SWAP_NO_COLLEAGUE,
  SWAP_NO_RETURN,
  SWAP_PREVIEW_READY,
  swapMonthOf,
  swapReturnValueOf,
  swapSendMessageKey,
  type SwapColleague,
  type SwapPreview,
  type SwapReturnOption,
} from '@/features/swaps/services/swap-proposal';
import {
  SWAP_COLLEAGUE_FIELD_ID,
  SWAP_ERROR_ID,
  SWAP_PREVIEW_ID,
  SWAP_RETURN_FIELD_ID,
} from '@/features/swaps/utils/element-ids';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { durationValuesOf } from '@/utils/time';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/** The roster line's words: `t` on the screen. */
const LINE_WORDS: RosterLineTranslate = {
  word: (key) => t(key),
  line: (key, values) => t(key, values),
};

/**
 * *Natrag na Kalendar*, above the title in every state, so the surface is
 * never a dead end: back to the month of `date` (`YYYY-MM-DD`), the month a
 * landed send returns to, or the calendar's own month without one.
 */
export function SwapProposalBack({ date }: { readonly date?: string | undefined }): ReactNode {
  return (
    <Button asChild variant="ghost" className="-ml-3 h-11 justify-self-start px-3">
      <Link to="/kalendar" search={date === undefined ? {} : { mjesec: monthOf(date) }}>
        <ArrowLeft aria-hidden />
        {t('kalendar.swap.back')}
      </Link>
    </Button>
  );
}

/** The skeleton while the snapshot is unanswered: the shift line and two fields. */
export function SwapProposalSkeleton(): ReactNode {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="h-6 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="h-11 animate-pulse rounded-md bg-muted" />
      <div className="h-11 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

/** `u rujnu` and `2026`: a `YYYY-MM` as a sentence of the preview names it (UX-DR34). */
function monthShown(month: string): { readonly month: string; readonly year: string } {
  const { key, year } = swapMonthOf(month);

  return { month: t(key), year };
}

/** `−12 h`, `+12 h 30 min` or `bez promjene`: the calendar preview's own words, signed. */
function deltaShown(deltaMinutes: number): string {
  if (deltaMinutes === 0) return t('kalendar.swap.noChange');

  const minutes = Math.abs(deltaMinutes);
  const duration = t(durationMessageKey(minutes), durationValuesOf(minutes));

  return deltaMinutes < 0
    ? t('kalendar.detail.preview.less', { duration })
    : t('kalendar.detail.preview.more', { duration });
}

/** A colleague's option line: `Ime · čin · položaj`, and why it cannot be chosen where it cannot. */
function colleagueLabel(colleague: SwapColleague, usesFireRanks: boolean): string {
  const { label } = outOptionOf(colleague, ranksShown({ usesFireRanks }), positionsShown({ usesFireRanks }), LINE_WORDS);

  return colleague.blocked === null ? label : t('kalendar.swap.taken', { line: label });
}

/** A return option's line: `subota 26.09.2026 · Smjena B · Noć 19:00–07:00`, and why it cannot be chosen where it cannot. */
function returnLabel(option: SwapReturnOption): string {
  const type = option.range === null ? option.typeName : t('kalendar.detail.typeTimes', { name: option.typeName, range: option.range });
  const line = t('kalendar.swap.shiftLine', { day: option.day, team: option.teamName, type });

  return option.blocked === null ? line : t('kalendar.swap.taken', { line });
}

/**
 * *Što se mijenja* (story 12.2): who works which date, and each member's
 * hours per month — the viewer's as *Sati* counts them, the colleague's by
 * their shifts alone. NEVER A GATE. A choice the roster would refuse anyway
 * says why instead.
 */
function renderPreview(
  preview: SwapPreview | null,
  nameOf: (memberId: string) => string,
  viewerId: string,
  leaveUnknown: boolean,
): ReactNode {
  if (preview === null) {
    return <p className="text-sm text-muted-foreground">{t('kalendar.swap.chooseColleague')}</p>;
  }

  if (preview.kind !== SWAP_PREVIEW_READY) {
    return <p className="text-sm font-medium">{t('kalendar.swap.blocked')}</p>;
  }

  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <span className="font-medium">{t('kalendar.swap.previewHeading')}</span>
      <span className="grid gap-1 rounded-md border bg-muted p-3">
        {preview.lines.map((line) => (
          <span key={`${line.day}/${line.teamName}`} className="block break-words tabular-nums">
            {line.outId === viewerId
              ? t('kalendar.swap.worksInstead', { day: line.day, team: line.teamName, name: nameOf(line.inId) })
              : t('kalendar.swap.youWorkInstead', { day: line.day, team: line.teamName, name: nameOf(line.outId) })}
          </span>
        ))}
        {preview.hours.map((delta) => (
          <span key={`${delta.memberId}/${delta.month}`} className="block break-words tabular-nums">
            {delta.memberId === viewerId
              ? t('kalendar.swap.hoursYou', { ...monthShown(delta.month), delta: deltaShown(delta.deltaMinutes) })
              : t('kalendar.swap.hoursOf', {
                  name: nameOf(delta.memberId),
                  ...monthShown(delta.month),
                  delta: deltaShown(delta.deltaMinutes),
                })}
          </span>
        ))}
        {leaveUnknown ? <span className="block text-muted-foreground">{t('kalendar.swap.leaveUnknown')}</span> : null}
      </span>
    </div>
  );
}

/**
 * *Predloži zamjenu* (story 12.2): the viewer's shift, a colleague, an
 * optional shift of theirs in return, what it would do, and one *Pošalji*.
 * Offline *Pošalji* is gated and the note says why. Every rule, option and
 * figure is `@/features/swaps/services/swap-proposal`'s; this renders them.
 */
export function SwapProposalFormBody({ form }: { readonly form: SwapProposalForm }): ReactNode {
  const { snapshot, given, colleagues, returnOptions, preview, failure, pending } = form;
  // STORY 8.3a: offline, *Pošalji* is gated and the note says why.
  const gate = useWriteGate();

  if (form.loading) {
    return <SwapProposalSkeleton />;
  }

  if (form.unavailable || snapshot === null) {
    return (
      <div className="grid min-w-0 gap-2">
        <Notice role="alert">{t('kalendar.swap.unavailable')}</Notice>
        {form.retryable ? (
          <Button
            ref={keepFocusOnAlert}
            className="h-11 w-full sm:w-auto sm:justify-self-start"
            type="button"
            variant="outline"
            onClick={form.retry}
          >
            {t('kalendar.retry')}
          </Button>
        ) : null}
      </div>
    );
  }

  // A shift that is not the viewer's own working shift from today on: a notice, and no form.
  if (given === null) {
    return <p className="text-sm">{t('kalendar.swap.notOwn')}</p>;
  }

  const viewerId = snapshot.viewer.memberId;
  const nameOf = (memberId: string) =>
    snapshot.members.find((member) => member.id === memberId)?.name ?? t('kalendar.detail.unknownMember');
  const givenType =
    given.typeName === null
      ? null
      : given.range === null
        ? given.typeName
        : t('kalendar.detail.typeTimes', { name: given.typeName, range: given.range });

  return (
    <form
      noValidate
      className="grid min-w-0 gap-4"
      onSubmit={(event) => {
        if (!gate.online) {
          event.preventDefault();
          return;
        }
        void form.send(event);
      }}
    >
      <div className="grid min-w-0 gap-1">
        <span className="text-xs text-muted-foreground">{t('kalendar.swap.given')}</span>
        <p className="text-base font-semibold tabular-nums">
          {t('kalendar.swap.shiftLine', { day: given.date, team: given.teamName, type: givenType ?? t('kalendar.detail.preview.noType') })}
        </p>
      </div>
      {/* DISABLED WHILE THE SEND IS OUTSTANDING, the fields included. */}
      <fieldset disabled={pending} aria-busy={pending} className="grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={SWAP_COLLEAGUE_FIELD_ID}>{t('kalendar.swap.colleague')}</Label>
          <Select
            ref={form.colleagueField}
            id={SWAP_COLLEAGUE_FIELD_ID}
            name="colleague"
            value={form.colleagueValue}
            required
            aria-describedby={failure === null ? undefined : SWAP_ERROR_ID}
            className="h-11"
            onChange={(event) => {
              form.chooseColleague(event.target.value);
            }}
          >
            <option value={SWAP_NO_COLLEAGUE}>{t('kalendar.swap.colleagueNone')}</option>
            {colleagues.map((colleague) => (
              <option key={colleague.id} value={colleague.id} disabled={colleague.blocked !== null}>
                {colleagueLabel(colleague, snapshot.usesFireRanks)}
              </option>
            ))}
          </Select>
          {colleagues.length === 0 ? <p className="text-sm text-muted-foreground">{t('kalendar.swap.noColleagues')}</p> : null}
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={SWAP_RETURN_FIELD_ID}>{t('kalendar.swap.returnShift')}</Label>
          <Select
            id={SWAP_RETURN_FIELD_ID}
            name="return"
            value={form.returnValue}
            disabled={form.colleagueValue === SWAP_NO_COLLEAGUE}
            className="h-11"
            onChange={(event) => {
              form.chooseReturn(event.target.value);
            }}
          >
            <option value={SWAP_NO_RETURN}>{t('kalendar.swap.returnNone')}</option>
            {returnOptions.map((option) => (
              <option key={swapReturnValueOf(option)} value={swapReturnValueOf(option)} disabled={option.blocked !== null}>
                {returnLabel(option)}
              </option>
            ))}
          </Select>
          <p className="text-sm text-muted-foreground">{t('kalendar.swap.returnHint')}</p>
        </div>
        <div id={SWAP_PREVIEW_ID} aria-live="polite" className="grid min-w-0 gap-2">
          {renderPreview(preview, nameOf, viewerId, form.leaveUnknown)}
        </div>
      </fieldset>
      {failure === null ? null : (
        <Notice id={SWAP_ERROR_ID} ref={form.alertField} role="alert" tabIndex={-1}>
          {t(swapSendMessageKey(failure))}
        </Notice>
      )}
      <OfflineWriteNote gate={gate} />
      <div className="flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline" className="h-11">
          <Link to="/kalendar" search={{ mjesec: monthOf(given.isoDate) }}>
            {t('kalendar.swap.cancel')}
          </Link>
        </Button>
        <Button
          className="h-11 aria-disabled:opacity-50"
          type="submit"
          disabled={pending}
          aria-disabled={gate.disabled}
          aria-describedby={gate.describedBy()}
          aria-busy={pending}
        >
          <PaperPlaneRight aria-hidden />
          {t('kalendar.swap.submit')}
        </Button>
      </div>
    </form>
  );
}
