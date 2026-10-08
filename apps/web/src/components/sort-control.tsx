import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { t } from '@/lib/i18n';
import { pickerIndexAfter } from '@/utils/filter-bar';
import {
  sortControlCursorClampOf,
  sortControlCursorOf,
  sortControlLabelOf,
  sortControlListedOf,
  type SortControlColumn,
  type SortControlDirection,
} from '@/utils/sort-control';

/**
 * The glyph each direction draws. A RECORD keyed by the direction's own
 * names, never a ternary: which way it points is the screen's sort module's
 * decision (`hoursSortArrowOf`, `sortIndicatorOf`), executed there.
 */
const DIRECTION_GLYPHS: Record<SortControlDirection, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
};

/**
 * THE PHONE'S SORT CONTROL (story 7.6), shared by *Sati* and *Ljudi*: below
 * 640 px the stacked rows have no column headings to press, so one
 * `Poredano: {column} ↑|↓` button above the list opens the 7.4 `Popover`
 * with every sortable column as an `aria-pressed` `Button`.
 *
 * A PICK IS A HEADING PRESS: `onPick` is the screen's own `pressColumn`, so a
 * new column starts ascending, the sorted one flips, and the state is the one
 * the table reads on the other side of 640 px.
 *
 * FOCUS: opening focuses the sorted column; ↑ ↓ Home End move the list's one
 * tab stop (the filter bar's picker rule, `pickerIndexAfter`). A pick and
 * Escape close the list and put focus back on the control; focus leaving the
 * control and its list closes the list where focus went.
 *
 * A column marked `listed: false` (one the phone row does not show) is not
 * offered, yet still names the trigger while it is the sorted one. The
 * sorted option says its direction in words, since its arrow is hidden from
 * readers. `disabled` holds the trigger as the table holds its headings
 * while the list is unanswered.
 */
export function SortControl<K extends string>({
  columns,
  active,
  direction,
  disabled = false,
  onPick,
}: {
  readonly columns: readonly SortControlColumn<K>[];
  readonly active: K;
  readonly direction: SortControlDirection;
  readonly disabled?: boolean;
  readonly onPick: (key: K) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const Glyph = DIRECTION_GLYPHS[direction];
  const column = sortControlLabelOf(columns, active);
  const directionName = { up: t('sort.ascending'), down: t('sort.descending') }[direction];

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  /** Focus leaving the control and its list closes the list where focus went. */
  function closeOnLeave(event: FocusEvent<HTMLDivElement>): void {
    const to = event.relatedTarget;

    if (open && to !== null && !event.currentTarget.contains(to)) setOpen(false);
  }

  return (
    <div ref={region} className="relative min-w-0 px-4" onBlur={closeOnLeave}>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        className="h-11 min-w-0 max-w-full gap-2 px-2 font-normal text-muted-foreground"
        // The visible words lead the name, and the direction the arrow draws
        // follows them in words: `Poredano: Ime, uzlazno`.
        aria-label={t('sort.name', { column, direction: directionName })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        <ArrowUpDown aria-hidden />
        <span className="truncate">{t('sort.label', { column })}</span>
        <Glyph aria-hidden className="size-4 shrink-0" />
      </Button>
      <Popover
        id={listId}
        open={open}
        onClose={close}
        region={region}
        aria-label={t('sort.picker')}
        className="left-4 w-64"
      >
        <SortOptions
          columns={sortControlListedOf(columns)}
          active={active}
          directionName={directionName}
          Glyph={Glyph}
          onPick={(key) => {
            close();
            onPick(key);
          }}
        />
      </Popover>
    </div>
  );
}

/**
 * The columns as `Button`s with `aria-pressed` on the sorted one and its
 * arrow beside it: one tab stop that ↑ ↓ Home End move, focused on the
 * sorted column on opening.
 */
function SortOptions<K extends string>({
  columns,
  active,
  directionName,
  Glyph,
  onPick,
}: {
  readonly columns: readonly SortControlColumn<K>[];
  readonly active: K;
  /** The sorted column's direction in words, which its hidden arrow draws. */
  readonly directionName: string;
  readonly Glyph: typeof ArrowUp;
  readonly onPick: (key: K) => void;
}): ReactNode {
  const [rawCursor, setCursor] = useState(() => sortControlCursorOf(columns, active));
  // Clamped, so a list that shrinks under an open picker keeps one tab stop.
  const cursor = sortControlCursorClampOf(rawCursor, columns.length);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // On opening only: the sorted column takes focus, as the filter bar's picker does.
  const opened = useRef(true);

  useEffect(() => {
    if (!opened.current) return;
    opened.current = false;
    buttons.current[cursor]?.focus();
  }, [cursor]);

  function register(index: number): (element: HTMLButtonElement | null) => void {
    return (element) => {
      buttons.current[index] = element;
    };
  }

  function moveOnKey(event: KeyboardEvent<HTMLDivElement>): void {
    const to = pickerIndexAfter(event.key, cursor, columns.length);

    if (to === null) return;
    event.preventDefault();
    setCursor(to);
    buttons.current[to]?.focus();
  }

  return (
    <div className="grid gap-0.5" onKeyDown={moveOnKey}>
      {columns.map((column, index) => (
        <Button
          key={column.key}
          ref={register(index)}
          type="button"
          variant="ghost"
          className="h-auto min-h-11 justify-between gap-3 whitespace-normal px-2 py-2 text-left font-normal aria-pressed:bg-primary/10 aria-pressed:font-semibold"
          tabIndex={index === cursor ? 0 : -1}
          aria-pressed={column.key === active}
          aria-label={
            column.key === active ? t('sort.option', { column: column.label, direction: directionName }) : undefined
          }
          onFocus={() => {
            setCursor(index);
          }}
          onClick={() => {
            onPick(column.key);
          }}
        >
          <span className="min-w-0 break-words">{column.label}</span>
          {column.key === active ? <Glyph aria-hidden className="size-4 shrink-0" /> : null}
        </Button>
      ))}
    </div>
  );
}
