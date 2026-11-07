import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { OfflineNote } from '@/components/offline-note';
import { OfflineWriteNote } from '@/components/offline-write-note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CaretLeft, Check, X } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import { durationMessageKey } from '@/features/hour-bands/services/list';
import { ShortStaffedBlock } from '@/features/staffing/components/short-staffed-block';
import type { SwapDecisionState } from '@/features/swaps/hooks/use-swap-decision';
import { SWAP_ACCEPTED, SWAP_APPROVED, SWAP_REJECTED } from '@/features/swaps/services/organization-swaps';
import {
  SWAP_SCREEN_CLOSED,
  SWAP_SCREEN_LOADING,
  SWAP_SCREEN_MISSING,
  SWAP_SCREEN_UNAVAILABLE,
  SWAP_SCREEN_WAITING,
  swapDecisionFailureMessageKey,
  swapStatusMessageKey,
  type SwapDecidedLine,
  type SwapDecisionFacts,
  type SwapDecisionPreview,
} from '@/features/swaps/services/swap-decision';
import { swapMonthOf } from '@/features/swaps/services/swap-proposal';
import {
  SWAP_DECISION_ERASURES_ID,
  SWAP_DECISION_HEADING_ID,
  SWAP_DECISION_PREVIEW_ID,
} from '@/features/swaps/utils/element-ids';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { keepFocusOnAlert } from '@/utils/retry-focus';
import { durationValuesOf } from '@/utils/time';

/** The way back to the queue, drawn in every state; held while a decision is in flight. */
function BackLink({ disabled = false }: { readonly disabled?: boolean }): ReactNode {
  return (
    <Button asChild variant="ghost" className="-ml-3 h-11 px-3 aria-disabled:opacity-50">
      <Link to="/za-odluku" disabled={disabled}>
        <CaretLeft aria-hidden />
        {t('zaOdluku.resolution.backToQueue')}
      </Link>
    </Button>
  );
}

/** `−12 h`, `+12 h 30 min` or `bez promjene`: the proposal preview's own words, signed. */
function deltaShown(deltaMinutes: number): string {
  if (deltaMinutes === 0) return t('kalendar.swap.noChange');

  const minutes = Math.abs(deltaMinutes);
  const duration = t(durationMessageKey(minutes), durationValuesOf(minutes));

  return deltaMinutes < 0
    ? t('kalendar.detail.preview.less', { duration })
    : t('kalendar.detail.preview.more', { duration });
}

/** Whose swap it is, its shifts, and where it stands, as a word in a badge. */
function SwapFacts({ facts }: { readonly facts: SwapDecisionFacts }): ReactNode {
  const { swap } = facts;

  return (
    <div className="grid min-w-0 gap-1">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-base font-semibold">
          {t('zaOdluku.swap.parties', { proposer: facts.proposerName, addressee: facts.addresseeName })}
        </span>
        <Badge variant={swap.status === SWAP_ACCEPTED ? 'default' : 'outline'}>{t(swapStatusMessageKey(swap.status))}</Badge>
      </p>
      <p className="min-w-0 break-words text-sm tabular-nums text-muted-foreground">
        {facts.returnShift === null
          ? t('zaOdluku.swap.shift', { date: facts.given.day, team: facts.given.teamName })
          : t('zaOdluku.swap.shifts', {
              given: t('zaOdluku.swap.shift', { date: facts.given.day, team: facts.given.teamName }),
              back: t('zaOdluku.swap.shift', { date: facts.returnShift.day, team: facts.returnShift.teamName }),
            })}
      </p>
    </div>
  );
}

/**
 * What the swap does once approved (R9.3): who works which date, each
 * member's hours per month, leave of a member it puts on a shift, a double
 * booking, and the shifts it newly leaves short of people. NEVER A GATE.
 */
function SwapPreview({ preview }: { readonly preview: SwapDecisionPreview | null }): ReactNode {
  if (preview === null) {
    return <p className="text-sm text-muted-foreground">{t('zaOdluku.swap.previewUnknown')}</p>;
  }

  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <span className="font-medium">{t('zaOdluku.swap.previewHeading')}</span>
      <span className="grid gap-1 rounded-md border bg-muted p-3">
        {preview.lines.map((line) => (
          <span key={`${line.day}/${line.teamName}`} className="block break-words tabular-nums">
            {t('zaOdluku.swap.worksInstead', { day: line.day, team: line.teamName, in: line.inName, out: line.outName })}
          </span>
        ))}
        {preview.hours.map((delta) => {
          const { key, year } = swapMonthOf(delta.month);

          return (
            <span key={`${delta.memberId}/${delta.month}`} className="block break-words tabular-nums">
              {t('zaOdluku.swap.hours', { name: delta.name, month: t(key), year, delta: deltaShown(delta.deltaMinutes) })}
            </span>
          );
        })}
      </span>
      {preview.onLeave.map((leave) => (
        <span key={`${leave.name}/${leave.day}`} className="block break-words font-medium tabular-nums">
          {t('zaOdluku.swap.onLeave', { name: leave.name, day: leave.day })}
        </span>
      ))}
      {preview.overlaps.map((overlap) => (
        <span key={`${overlap.memberName}/${overlap.date}`} className="block break-words font-medium tabular-nums">
          {t('kalendar.detail.rosterChange.set.overlap', {
            name: overlap.memberName,
            team: overlap.teamName,
            day: overlap.day,
            range: overlap.range,
          })}
        </span>
      ))}
      {/* STORY 11.2: the shifts approval would newly leave short of people, never a gate. */}
      <ShortStaffedBlock report={preview.shortStaffed} />
    </div>
  );
}

/** A read-only swap's line: who decided and when; a swap never decided says its word alone. */
function DecidedLine({ line }: { readonly line: SwapDecidedLine | null }): ReactNode {
  if (line === null) return null;

  return (
    <p className="min-w-0 break-words text-sm tabular-nums text-muted-foreground">
      {t('zaOdluku.resolved.decided', { actor: line.actor ?? t('zaOdluku.resolved.actorGone'), date: line.date, time: line.time })}
    </p>
  );
}

/** The refusal of the last decision, under the heading, which takes focus once drawn. */
function FailureNotice({ state }: { readonly state: SwapDecisionState }): ReactNode {
  if (state.failure === null) return null;

  return (
    <Notice ref={state.alertField} role="alert" tabIndex={-1}>
      {t(swapDecisionFailureMessageKey(state.failure))}
    </Notice>
  );
}

/**
 * A waiting swap's decisions: *Odbij* and *Odobri*, one in flight at a time,
 * gated offline. *Odobri* is withheld from a stale swap, and after an
 * approval refused as the swap stands (`state.canApprove`). A check that
 * cannot be derived refuses the approval here, with its retry.
 */
function Decisions({ state }: { readonly state: SwapDecisionState }): ReactNode {
  // STORY 8.3a: offline, both are gated and the note says why.
  const gate = useWriteGate();
  const busy = state.pending !== null;
  const reason = t('zaOdluku.swap.approvalReason');

  return (
    <>
      {state.unchecked ? (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t('zaOdluku.swap.unchecked')}</Notice>
          <Button
            ref={state.retryButton}
            className="h-11 w-full aria-disabled:opacity-50 sm:w-auto sm:justify-self-start"
            type="button"
            variant="outline"
            aria-disabled={gate.disabled ?? (busy ? true : undefined)}
            aria-describedby={gate.describedBy()}
            onClick={() => {
              if (!gate.online) return;
              void state.approve(reason);
            }}
          >
            {t('zaOdluku.swap.retry')}
          </Button>
        </div>
      ) : null}
      <OfflineWriteNote gate={gate} />
      <div className="flex min-w-0 flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto aria-disabled:opacity-50"
          aria-disabled={gate.disabled ?? (busy ? true : undefined)}
          aria-describedby={gate.describedBy()}
          aria-busy={state.pending === SWAP_REJECTED}
          onClick={() => {
            if (!gate.online) return;
            void state.reject();
          }}
        >
          <X aria-hidden />
          {t('zaOdluku.swap.reject')}
        </Button>
        {state.canApprove ? (
          <Button
            ref={state.approveButton}
            type="button"
            className="h-11 w-full sm:w-auto aria-disabled:opacity-50"
            aria-disabled={gate.disabled ?? (busy ? true : undefined)}
            aria-describedby={gate.describedBy()}
            aria-busy={state.pending === SWAP_APPROVED}
            onClick={() => {
              if (!gate.online) return;
              void state.approve(reason);
            }}
          >
            <Check aria-hidden />
            {t('zaOdluku.swap.approve')}
          </Button>
        ) : null}
      </div>
    </>
  );
}

/**
 * The approval's erasure confirmation (AD-5): the shared `ErasureDialog`,
 * one row per collision the swap would erase, its save *Odobri*. A swap
 * changes who is rostered, never whether the team works, so every row reads
 * "taj dan bez {member}", as a calendar roster change's do.
 */
function SwapErasureConfirm({ state }: { readonly state: SwapDecisionState }): ReactNode {
  const gate = useWriteGate();
  const shown = state.erasures.shown;

  if (shown === null) return null;

  const { rows } = shown;
  const partsOf = (row: ErasureRow) => ({ team: row.teamName, weekday: row.weekday, date: row.dayMonth, type: row.shiftTypeName });
  const reason = t('zaOdluku.swap.approvalReason');

  return (
    <ErasureDialog
      saveButton={state.erasuresSaveButton}
      id={SWAP_DECISION_ERASURES_ID}
      rows={rows}
      changed={shown.changed}
      decisions={state.erasures.decisions}
      busy={state.pending !== null}
      firstErasure={state.erasures.firstErasure}
      copy={{
        title: t('zaOdluku.swap.erasures.title', { count: rows.length }),
        lede: t('zaOdluku.swap.erasures.lede', { count: rows.length }),
        changed: t('kalendar.detail.rosterChange.erasures.changed'),
        rowTitle: (row) => t('kalendar.detail.rosterChange.erasures.rowTitle', partsOf(row)),
        rowDetail: (row) =>
          t('kalendar.detail.rosterChange.erasures.rowWithout', { member: row.memberName, team: row.teamName }),
        decision: (row) => t('kalendar.detail.rosterChange.erasures.decision', partsOf(row)),
        confirm: t('kalendar.detail.rosterChange.erasures.confirm'),
        keep: t('kalendar.detail.rosterChange.erasures.keep'),
        back: t('zaOdluku.swap.erasures.back'),
        kept: t('zaOdluku.swap.erasures.kept'),
        save: t('zaOdluku.swap.approve'),
      }}
      saveIcon={<Check aria-hidden />}
      gate={gate}
      onDecide={state.erasures.decide}
      onBack={state.erasures.close}
      onSave={() => {
        void state.confirmErasures(shown, reason);
      }}
    />
  );
}

/**
 * What one swap's decision screen shows (story 12.4): the skeleton while its
 * reads are unanswered, one alert with a retry when a read failed,
 * "Zamjena ne postoji." for an unknown id, a waiting swap with what it does
 * and both decisions — *Datum je prošao* on a past one, the reason and no
 * *Odobri* on a stale one — or any other swap read-only: its status word, and
 * who decided and when. `swapDecisionOf` decides which; this only draws it.
 * The way back and the heading are drawn in every state, and the as-of note
 * under them while the cached snapshot is drawn offline.
 */
export function SwapDecisionBody({ state }: { readonly state: SwapDecisionState }): ReactNode {
  const { screen } = state;

  return (
    <>
      <PageHeader>
        <div className="grid min-w-0 justify-items-start gap-1">
          <BackLink disabled={state.pending !== null} />
          <PageTitle asChild>
            <h1 ref={state.heading} id={SWAP_DECISION_HEADING_ID} tabIndex={-1} className="outline-none">
              {t('zaOdluku.swap.heading')}
            </h1>
          </PageTitle>
        </div>
      </PageHeader>
      <OfflineNote offline={state.offline} />
      {/* ONE PLACE FOR A REFUSAL, in either state its re-read may leave the swap drawn in; the unavailable state has its own one alert. */}
      {screen.kind === SWAP_SCREEN_WAITING || screen.kind === SWAP_SCREEN_CLOSED ? <FailureNotice state={state} /> : null}
      {screen.kind === SWAP_SCREEN_LOADING ? <div aria-hidden className="h-40 animate-pulse rounded-md bg-muted" /> : null}
      {screen.kind === SWAP_SCREEN_MISSING ? <Notice role="status">{t('zaOdluku.swap.missing')}</Notice> : null}
      {screen.kind === SWAP_SCREEN_UNAVAILABLE ? (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t('zaOdluku.swap.unavailable')}</Notice>
          {state.retryable ? (
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={state.retry}
            >
              {t('zaOdluku.resolution.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {screen.kind === SWAP_SCREEN_CLOSED ? (
        <Card className="grid min-w-0 gap-3 p-4">
          <SwapFacts facts={screen.facts} />
          <DecidedLine line={screen.line} />
        </Card>
      ) : null}
      {screen.kind === SWAP_SCREEN_WAITING ? (
        <Card className="grid min-w-0 gap-4 p-4">
          <SwapFacts facts={screen.facts} />
          {screen.past ? <p className="text-sm font-medium">{t('zaOdluku.swap.past')}</p> : null}
          <div id={SWAP_DECISION_PREVIEW_ID} aria-live="polite" className="grid min-w-0 gap-2 border-t pt-4">
            {/* A STALE SWAP says why *Odobri* is withheld, then whatever of it can still be derived. */}
            {screen.stale ? <p className="text-sm font-medium">{t('zaOdluku.swap.stale')}</p> : null}
            {screen.stale && screen.preview === null ? null : <SwapPreview preview={screen.preview} />}
          </div>
          <Decisions state={state} />
        </Card>
      ) : null}
      <SwapErasureConfirm state={state} />
    </>
  );
}
