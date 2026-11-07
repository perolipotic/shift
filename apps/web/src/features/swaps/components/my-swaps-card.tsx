import type { QueryKey } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowUUpLeft, Check, X } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { durationMessageKey } from '@/features/hour-bands/services/list';
import { useMySwaps } from '@/features/swaps/hooks/use-my-swaps';
import {
  SWAP_ACCEPT,
  SWAP_DECLINE,
  SWAP_WITHDRAW,
  swapActFailureMessageKey,
  swapActedMessageKey,
  swapWordMessageKey,
  type MySwapRow,
  type SwapConsequence,
  type SwapShiftShown,
} from '@/features/swaps/services/my-swaps';
import { swapMonthOf } from '@/features/swaps/services/swap-proposal';
import { MY_SWAPS_HEADING_ID } from '@/features/swaps/utils/element-ids';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { durationValuesOf } from '@/utils/time';

/** A shift's words for a message: its day, and its team's name or the words for one the snapshot does not hold. */
function shiftNamed(shift: SwapShiftShown): { readonly day: string; readonly team: string } {
  return { day: shift.day, team: shift.team ?? t('danas.swaps.unknownTeam') };
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

/**
 * *Što se mijenja nakon odobrenja*, the addressee's own (story 12.3): who
 * works which date and their hours per month, the proposal preview's words.
 * NEVER A GATE.
 */
function renderConsequence(consequence: SwapConsequence, colleague: string, leaveUnknown: boolean): ReactNode {
  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <span className="font-medium">{t('kalendar.swap.previewHeading')}</span>
      <span className="grid gap-1 rounded-md border bg-muted p-3">
        {consequence.lines.map((line) => (
          <span key={`${line.shift.day}/${String(line.viewerWorks)}`} className="block break-words tabular-nums">
            {line.viewerWorks
              ? t('kalendar.swap.youWorkInstead', { ...shiftNamed(line.shift), name: colleague })
              : t('kalendar.swap.worksInstead', { ...shiftNamed(line.shift), name: colleague })}
          </span>
        ))}
        {consequence.hours.map((delta) => {
          const { key, year } = swapMonthOf(delta.month);

          return (
            <span key={delta.month} className="block break-words tabular-nums">
              {t('kalendar.swap.hoursYou', { month: t(key), year, delta: deltaShown(delta.deltaMinutes) })}
            </span>
          );
        })}
        {leaveUnknown ? <span className="block text-muted-foreground">{t('kalendar.swap.leaveUnknown')}</span> : null}
      </span>
    </div>
  );
}

/**
 * *Zamjene* (story 12.3, FR-67, FR-69): the viewer's own swaps from both
 * sides on *Danas* — after the next shift on a member's, after *Treba tebe*
 * on an admin's — drawn only while there is a row. Each names the date, the
 * shift, the colleague and any return shift, its status as a WORD in a badge,
 * *Datum je prošao* on an open one whose date has passed, and, to the
 * addressee, what it does to them. *Prihvati* and *Odbij* on a proposed swap
 * for the addressee (no *Prihvati* on a stale or past one), *Povuci* for the
 * proposer while it is open and for the addressee once accepted — with no
 * confirmation. An open swap that no longer applies says so on either side.
 * While one action is in flight every button is `aria-disabled` (never
 * natively disabled, so focus stays) and only the acting row is busy; the
 * hook's ref is the guard. Offline each is gated and the note says why.
 * `mySwapRowsOf` decides every row; this only draws them.
 */
export function MySwapsCard({ surfaceKeys }: { readonly surfaceKeys: readonly QueryKey[] }): ReactNode {
  const { rows, leaveUnknown, pendingId, refusal, acted, act, outcomeField, heading } = useMySwaps(surfaceKeys);
  // STORY 8.3a: offline, every button is gated and the note says why.
  const gate = useWriteGate();

  if (rows.length === 0 && refusal === null && acted === null) return null;

  /** One swap's row: what it is, its word, its consequence and its buttons. */
  function renderRow(row: MySwapRow): ReactNode {
    const colleague = row.colleagueName ?? t('kalendar.detail.unknownMember');
    const busy = pendingId !== null;
    const pending = pendingId === row.swap.id;
    const named = shiftNamed(row.given);

    return (
      <li key={row.swap.id} className="grid min-w-0 gap-2 py-3">
        <p className="break-words font-semibold tabular-nums">{t('danas.swaps.shift', named)}</p>
        <p className="break-words text-sm">
          {row.viewerIsAddressee
            ? t('danas.swaps.fromColleague', { name: colleague })
            : t('danas.swaps.toColleague', { name: colleague })}
        </p>
        {row.returnShift === null ? null : (
          <p className="break-words text-sm tabular-nums">
            {row.viewerIsAddressee
              ? t('danas.swaps.returnTheirs', { name: colleague, ...shiftNamed(row.returnShift) })
              : t('danas.swaps.returnYours', shiftNamed(row.returnShift))}
          </p>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={row.waitsForViewer ? 'default' : 'outline'}>{t(swapWordMessageKey(row.word))}</Badge>
          {row.past ? <span className="text-sm text-muted-foreground">{t('danas.swaps.past')}</span> : null}
        </div>
        {/* An open swap that no longer applies says so on either side: the addressee may still decline it, anyone with *Povuci* withdraw it. */}
        {row.stale ? <p className="text-sm">{row.canDecline ? t('danas.swaps.stale') : t('danas.swaps.staleWithdraw')}</p> : null}
        {row.consequence === null ? null : renderConsequence(row.consequence, colleague, leaveUnknown)}
        {row.canAccept || row.canDecline || row.canWithdraw ? (
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
            {row.canAccept ? (
              <Button
                className="h-11 w-full aria-disabled:opacity-50 sm:w-auto"
                type="button"
                aria-busy={pending}
                aria-disabled={gate.disabled || busy}
                aria-describedby={gate.describedBy()}
                aria-label={t('danas.swaps.acceptName', named)}
                onClick={() => {
                  if (!gate.online || busy) return;
                  void act(row, SWAP_ACCEPT);
                }}
              >
                <Check aria-hidden />
                {t('danas.swaps.accept')}
              </Button>
            ) : null}
            {row.canDecline ? (
              <Button
                className="h-11 w-full aria-disabled:opacity-50 sm:w-auto"
                type="button"
                variant="outline"
                aria-busy={pending}
                aria-disabled={gate.disabled || busy}
                aria-describedby={gate.describedBy()}
                aria-label={t('danas.swaps.declineName', named)}
                onClick={() => {
                  if (!gate.online || busy) return;
                  void act(row, SWAP_DECLINE);
                }}
              >
                <X aria-hidden />
                {t('danas.swaps.decline')}
              </Button>
            ) : null}
            {row.canWithdraw ? (
              <Button
                className="h-11 w-full aria-disabled:opacity-50 sm:w-auto"
                type="button"
                variant="outline"
                aria-busy={pending}
                aria-disabled={gate.disabled || busy}
                aria-describedby={gate.describedBy()}
                aria-label={t('danas.swaps.withdrawName', named)}
                onClick={() => {
                  if (!gate.online || busy) return;
                  void act(row, SWAP_WITHDRAW);
                }}
              >
                <ArrowUUpLeft aria-hidden />
                {t('danas.swaps.withdraw')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <Card className="min-w-0">
      <section aria-labelledby={MY_SWAPS_HEADING_ID} className="grid min-w-0 gap-3 p-4 sm:p-6">
        <h2 ref={heading} id={MY_SWAPS_HEADING_ID} tabIndex={-1} className="font-heading text-lg font-semibold">
          {t('danas.swaps.heading')}
        </h2>
        {refusal === null ? null : (
          <Notice ref={outcomeField} role="alert" tabIndex={-1}>
            {t(swapActFailureMessageKey(refusal.code), shiftNamed(refusal.shift))}
          </Notice>
        )}
        {acted === null ? null : (
          <Notice ref={outcomeField} role="status" tabIndex={-1}>
            {t(swapActedMessageKey(acted.action), shiftNamed(acted.shift))}
          </Notice>
        )}
        {rows.some((row) => row.canAccept || row.canDecline || row.canWithdraw) ? <OfflineWriteNote gate={gate} /> : null}
        {rows.length === 0 ? null : (
          <ul className="grid min-w-0 divide-y">
            {rows.map(renderRow)}
          </ul>
        )}
      </section>
    </Card>
  );
}
