import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { t } from '@/lib/i18n';
import { focusLater } from '@/utils/focus-later';
import {
  FIRST_YEAR,
  LAST_YEAR,
  monthMovedBy,
  monthNameOf,
  monthShortNameOf,
  monthStepOfKey,
  monthsOfYear,
  pickerMonthAfter,
  sameMonthIn,
  yearOfMonth,
  yearTextOf,
} from '@/utils/month-keys';

/**
 * What the month toolbar draws: the month shown and its name and year, the
 * adjacent months (`null` where there is nowhere to go), whether it is the
 * current one, and the current one itself. A calendar month and an hours month
 * both satisfy it.
 */
export interface MonthNavMonth {
  readonly month: string;
  readonly monthName: string;
  readonly year: string;
  readonly previous: string | null;
  readonly next: string | null;
  readonly isCurrent: boolean;
  readonly current: string;
}

/**
 * The month toolbar, shared by *Kalendar* and *Sati* (story 4.1b, one
 * toolbar since story 7.4): ‹ month ▾ › in one group named "Mjesec", the
 * month a button that opens a twelve-month picker. PgUp and PgDn step the
 * month while focus is in the group, and do nothing where the ‹ › they
 * stand for are disabled. On the current month an "ovaj mjesec" label sits in
 * the trigger; on any other, `Ovaj mjesec` follows the group as a button. A
 * placeholder bar while no month is shown.
 *
 * The heading stays, visually hidden: it carries `headingId`, names the grid
 * and the day list, and takes focus by it — the calendar's when a closed day
 * detail's opener is gone.
 *
 * `onShow(null)` is the current month. The copy stays under `kalendar.*`,
 * where both screens' month navigation has always read it.
 */
export function MonthNav({
  month,
  headingId,
  onShow,
}: {
  readonly month: MonthNavMonth | null;
  readonly headingId: string;
  readonly onShow: (mjesec: string | null) => void;
}): ReactNode {
  // OPEN ON A MONTH, not just open: the picker belongs to the month it was
  // opened on, so any change of the month — PgUp/PgDn on the trigger, browser
  // Back, a reload through a loading state — closes it without moving focus.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const shownMonth = month?.month ?? null;
  const open = shownMonth !== null && openOn === shownMonth;
  const region = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pickerId = useId();

  useEffect(() => {
    setOpenOn((was) => (was === shownMonth ? was : null));
  }, [shownMonth]);

  /**
   * Focus to the trigger — at once, so a key pressed right after a close
   * already lands in the toolbar — or, while it is not drawn, as soon as it
   * is; the heading if it never comes.
   */
  const focusTrigger = useCallback(() => {
    if (trigger.current?.isConnected === true) {
      trigger.current.focus();

      return;
    }
    focusLater([() => trigger.current], () => document.getElementById(headingId));
  }, [headingId]);

  const close = useCallback(() => {
    setOpenOn(null);
    focusTrigger();
  }, [focusTrigger]);

  if (month === null) {
    return <div className="h-11 w-56 animate-pulse rounded-md bg-muted" />;
  }

  /**
   * One month back (`-1`) or on (`1`), from ‹, › or PgUp/PgDn. Where the new
   * month is a bound, the control that stands for this direction disables
   * under focus, so focus moves to the trigger instead of falling to <body>.
   */
  function step(direction: -1 | 1): void {
    if (month === null) return;

    const to = direction < 0 ? month.previous : month.next;

    if (to === null) return;
    onShow(to);
    if (monthMovedBy(to, direction) === to) focusTrigger();
  }

  /** PgUp and PgDn, anywhere in the group: the ‹ and › they stand for. */
  function stepOnKey(event: KeyboardEvent<HTMLDivElement>): void {
    const direction = monthStepOfKey(event.key, event);

    if (direction === null) return;
    event.preventDefault();
    step(direction);
  }

  /**
   * Focus leaving the toolbar and its picker — Tab out of the picker — closes
   * the picker where focus went. A blur to nowhere (a press on the picker's
   * padding, the window losing focus) is not leaving it.
   */
  function closeOnLeave(event: FocusEvent<HTMLDivElement>): void {
    const to = event.relatedTarget;

    if (open && to !== null && !event.currentTarget.contains(to)) setOpenOn(null);
  }

  const triggerName = t('kalendar.chooseMonth', { month: month.monthName, year: month.year });

  return (
    <>
      <h2 id={headingId} tabIndex={-1} className="sr-only">
        {t('kalendar.monthHeading', { month: month.monthName, year: month.year })}
      </h2>
      <div ref={region} className="relative" onBlur={closeOnLeave}>
        <div
          role="group"
          aria-label={t('kalendar.month')}
          className="inline-flex items-stretch gap-1"
          onKeyDown={stepOnKey}
        >
          <Button
            type="button"
            variant="outline"
            className="h-11 w-11 p-0"
            aria-label={t('kalendar.previous')}
            disabled={month.previous === null}
            onClick={() => {
              step(-1);
            }}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            ref={trigger}
            type="button"
            variant="outline"
            className="h-11 gap-1 px-2 sm:min-w-44 sm:gap-2 sm:px-3"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? pickerId : undefined}
            aria-label={month.isCurrent ? `${triggerName}, ${t('kalendar.thisMonthLabel')}` : triggerName}
            onClick={() => {
              if (open) close();
              else setOpenOn(month.month);
            }}
          >
            {/* On a phone the label sits under the month, so ‹ month › fits 320 px. */}
            <span className="flex flex-col items-center leading-tight sm:flex-row sm:gap-2">
              <span className="font-bold">{t('kalendar.monthHeading', { month: month.monthName, year: month.year })}</span>
              {month.isCurrent ? <Badge variant="outline">{t('kalendar.thisMonthLabel')}</Badge> : null}
            </span>
            <ChevronDown aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-11 p-0"
            aria-label={t('kalendar.next')}
            disabled={month.next === null}
            onClick={() => {
              step(1);
            }}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <Popover
          id={pickerId}
          open={open}
          onClose={close}
          region={region}
          aria-label={t('kalendar.monthPicker')}
          className="w-[17rem]"
        >
          <MonthPicker
            month={month}
            onPick={(picked) => {
              close();
              if (picked !== month.month) onShow(picked === month.current ? null : picked);
            }}
          />
        </Popover>
      </div>
      {month.isCurrent ? null : (
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => {
            onShow(null);
            focusTrigger();
          }}
        >
          {t('kalendar.current')}
        </Button>
      )}
    </>
  );
}

/**
 * The picker's year and its twelve months: the year's ‹ ›, disabled at the
 * calendar's first and last year, and a roving tab stop over the months, ←/→
 * by one and ↑/↓ by a row, crossing into the year before or after. It opens
 * on the shown month's year, focused on the shown month. The shown month is
 * filled and `aria-current`; the current month carries an inset ring and
 * "ovaj". Mounted only while open, so every opening starts from the month
 * shown.
 */
function MonthPicker({
  month,
  onPick,
}: {
  readonly month: MonthNavMonth;
  readonly onPick: (month: string) => void;
}): ReactNode {
  const [cursor, setCursor] = useState(month.month);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // Focus follows the cursor only when a key or the opening moved it, or a
  // year's ‹ › reached a bound and disabled under focus; otherwise the
  // year's ‹ › move the cursor and keep focus where it is.
  const follow = useRef(true);
  const year = yearOfMonth(cursor);
  const months = monthsOfYear(year);

  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    buttons.current[Number(cursor.slice(5, 7)) - 1]?.focus();
  }, [cursor]);

  /** The cursor to the same month in `to`; focus to it when `to` is a bound. */
  function showYear(to: number): void {
    if (to <= FIRST_YEAR || to >= LAST_YEAR) follow.current = true;
    setCursor(sameMonthIn(cursor, to));
  }

  /** The ref of the month button at `index`, so focus can follow the cursor. */
  function register(index: number): (element: HTMLButtonElement | null) => void {
    return (element) => {
      buttons.current[index] = element;
    };
  }

  function moveOnKey(event: KeyboardEvent<HTMLDivElement>): void {
    const to = pickerMonthAfter(event.key, cursor, event);

    if (to === null) return;
    event.preventDefault();
    event.stopPropagation();
    follow.current = true;
    setCursor(to);
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-11 p-0"
          aria-label={t('kalendar.previousYear')}
          disabled={year <= FIRST_YEAR}
          onClick={() => {
            showYear(year - 1);
          }}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <span className="font-bold tabular-nums" aria-live="polite">
          {yearTextOf(year)}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-11 p-0"
          aria-label={t('kalendar.nextYear')}
          disabled={year >= LAST_YEAR}
          onClick={() => {
            showYear(year + 1);
          }}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-1.5" onKeyDown={moveOnKey}>
        {months.map((candidate, index) => {
          const shown = candidate === month.month;
          const current = candidate === month.current;
          const name = t('kalendar.monthHeading', { month: monthNameOf(candidate), year: yearTextOf(year) });

          return (
            <Button
              key={candidate}
              ref={register(index)}
              type="button"
              variant={shown ? 'default' : 'ghost'}
              className="h-11 flex-col gap-0 px-0 leading-tight data-[current=true]:ring-[1.5px] data-[current=true]:ring-inset data-[current=true]:ring-input"
              data-current={current}
              tabIndex={candidate === cursor ? 0 : -1}
              aria-current={shown ? 'true' : undefined}
              aria-label={current ? `${name}, ${t('kalendar.thisMonthLabel')}` : name}
              onClick={() => {
                onPick(candidate);
              }}
            >
              {monthShortNameOf(candidate)}
              {current ? <span className="text-[0.625rem] font-semibold">{t('kalendar.thisMonthShort')}</span> : null}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
