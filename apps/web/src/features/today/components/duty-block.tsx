import { DUTY_DONE, type DutyPhase } from '@shift/domain';
import { CircleCheck, CircleDashed, CircleDot, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import {
  dutyEndLineMessageKey,
  dutyHeadlineMessageKey,
  dutyLegStateMessageKey,
  dutyNoteMessageKey,
  endLinePointOf,
  NOTE_REPLACING,
  type DutyDuration,
  type DutyLegNote,
  type DutyPoint,
  type TodayDuty,
  type TodayDutyLeg,
} from '@/features/today/services/today-duty';
import { t } from '@/lib/i18n';

/** Each leg state's icon: a shape as well as its word, never a colour alone. */
const LEG_ICONS: Readonly<Record<DutyPhase, LucideIcon>> = {
  done: CircleCheck,
  running: CircleDot,
  upcoming: CircleDashed,
};

/** `9 h 50 min`. */
function durationText(duration: DutyDuration): string {
  return t(duration.key, duration.values);
}

/** `01.10. 07:00`: one end of the span. */
function pointText(point: DutyPoint): string {
  return t('danas.duty.moment', { date: point.dayMonth, time: point.time });
}

/** Whose shift a leg is, in words: the member replaced is named only on a replacement. */
function noteText(note: DutyLegNote): string {
  return note.kind === NOTE_REPLACING
    ? t(dutyNoteMessageKey(note.kind), { name: note.member, team: note.team })
    : t(dutyNoteMessageKey(note.kind), { team: note.team });
}

/** One leg: its state in words with its icon, then the type, its range and whose shift it is. */
function renderLeg(leg: TodayDutyLeg, index: number): ReactNode {
  const Icon = LEG_ICONS[leg.state];

  return (
    <li key={String(index)} className="flex min-w-0 items-start gap-2">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="grid min-w-0 gap-0.5">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">{t(dutyLegStateMessageKey(leg.state))}</span>
          <span className="font-semibold">{leg.name}</span>
          {leg.range === null ? null : <span className="tabular-nums">{leg.range}</span>}
        </p>
        <p className="min-w-0 break-words text-sm text-muted-foreground">{noteText(leg.note)}</p>
      </div>
    </li>
  );
}

/**
 * Today's 24 h duty as one card (story 6.2): the total as the kicker, the
 * END as the headline — "do 07:00" — with the day and what remains, or when
 * it starts; once ended, when it ended. A progress bar in `primary`
 * announces how much is done in words, the span sits under it, and each
 * shift is one leg marked in words and by an icon. Nothing to tap.
 */
export function DutyBlock({ duty }: { readonly duty: TodayDuty }): ReactNode {
  const headingId = useId();
  const progress = t('danas.duty.progress', {
    done: durationText(duty.elapsed),
    total: durationText(duty.total),
  });
  const percent = duty.totalMinutes === 0 ? 0 : (duty.elapsedMinutes / duty.totalMinutes) * 100;

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="grid min-w-0 gap-3 p-4 sm:p-6">
        <h2 id={headingId} className="text-sm font-semibold text-muted-foreground tabular-nums">
          {t('danas.duty.kicker', { total: durationText(duty.total) })}
        </h2>
        <div className="grid min-w-0 gap-1">
          <p className="text-2xl font-bold tabular-nums">
            {t(dutyHeadlineMessageKey(duty.phase), { time: duty.end.time })}
          </p>
          {duty.phase === DUTY_DONE ? null : (
            <p className="min-w-0 break-words tabular-nums">
              {t(dutyEndLineMessageKey(duty.phase), {
                weekday: endLinePointOf(duty).weekday,
                date: endLinePointOf(duty).dayMonth,
                duration: durationText(duty.remaining),
                time: duty.start.time,
              })}
            </p>
          )}
        </div>
        <div className="grid min-w-0 gap-1">
          <div
            role="progressbar"
            aria-labelledby={headingId}
            aria-valuemin={0}
            aria-valuemax={duty.totalMinutes}
            aria-valuenow={duty.elapsedMinutes}
            aria-valuetext={progress}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${String(percent)}%` }} />
          </div>
          <p className="flex min-w-0 flex-wrap justify-between gap-x-3 text-xs text-muted-foreground tabular-nums">
            <span>{pointText(duty.start)}</span>
            {/* The bar's own valuetext already says it to a screen reader. */}
            <span aria-hidden>{progress}</span>
            <span>{pointText(duty.end)}</span>
          </p>
        </div>
        <ul className="grid gap-3">{duty.legs.map(renderLeg)}</ul>
      </section>
    </Card>
  );
}
