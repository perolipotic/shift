import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CaretDown, FunnelSimple, Users, X } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover } from '@/components/ui/popover';
import { useCloseWhenCrossing } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import {
  ALL_TEAMS_OPTION,
  FILTERS_CLEARED,
  FILTER_PERSON,
  FILTER_TEAM,
  FIRST_CHIP,
  KEEP_IN_VIEW,
  NO_SEARCH,
  NO_TEAM_OPTION,
  activeChipsOf,
  entersPickerList,
  filterBadgeCountOf,
  filterChipMessageKey,
  filterChoiceOf,
  filterRemovalOf,
  filterRemoveMessageKey,
  filterStateKeyOf,
  filterSummaryMessageKey,
  filterSummaryValuesOf,
  focusAfterRemovalOf,
  hasActiveFilter,
  modelStateKeyOf,
  optionsMatching,
  peopleGroupsOf,
  pickerIndexAfter,
  teamPickedOf,
  typesIntoSearch,
  type FilterBarModel,
  type FilterChange,
  type FilterKey,
} from '@/utils/filter-bar';

/**
 * What a screen can ask of the bar: make `change`, and once the model shows
 * it, put focus on the first chip drawn — or on `Filtri` where no chip is.
 * The empty *Sati* table's two ways out use it.
 */
export interface FilterBarHandle {
  changeAndFocusFirst(change: FilterChange): void;
}

/** An element focus can actually land on: in the document and drawn. */
export function drawn(element: HTMLElement | null | undefined): HTMLElement | null {
  return element !== null && element !== undefined && element.isConnected && element.getClientRects().length > 0
    ? element
    : null;
}

/** A button focus can land on that is not disabled. */
function enabled(element: HTMLButtonElement | null | undefined): HTMLElement | null {
  return element === null || element === undefined || element.disabled ? null : drawn(element);
}

/** Of `elements`, the one drawn first in document order, if any is drawn. */
function firstDrawn(elements: readonly (HTMLElement | null)[]): HTMLElement | null {
  return elements
    .map(drawn)
    .filter((element) => element !== null)
    .reduce<HTMLElement | null>(
      (first, element) =>
        first === null || first.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING ? element : first,
      null,
    );
}

/**
 * THE BAR'S FOCUS AND ITS SHEET (story 15.7), shared by {@link FilterBar} and
 * the option-chip bar.
 *
 * FOCUS WAITS FOR THE CHANGE: a ✕, `Očisti sve` or the empty *Sati* table's
 * ways out record which chip should take focus — `null` for `Filtri`,
 * {@link FIRST_CHIP} for the first chip drawn — and the state the change
 * leaves; an effect moves focus once the bar reads that state, so it lands on
 * what the re-render draws, never on a chip it removed, with `Filtri` the
 * fallback.
 *
 * THE SHEET opens from `Filtri` or a chip's body, focusing that chip's field
 * (the first field from `Filtri`). It closes on `Prikaži…`, on Escape, on its
 * close and when the viewport crosses 1024 px — where it changes edge — and
 * every way it closes puts focus on `Filtri`.
 */
export function useFilterBarState(stateKey: string) {
  const chips = useRef(new Map<string, HTMLButtonElement | null>());
  const root = useRef<HTMLDivElement>(null);
  const filtri = useRef<HTMLButtonElement>(null);
  const fields = useRef(new Map<string, HTMLButtonElement | null>());
  const pending = useRef<{ readonly target: string | null; readonly state: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetField, setSheetField] = useState<string | null>(null);
  const wasOpen = useRef(false);
  const sheetId = useId();
  const titleId = useId();

  /**
   * Where focus goes when the control it was meant for is gone: `Filtri`, else
   * the first chip still enabled, else the bar itself (it takes focus from
   * script only) — never `<body>`.
   */
  const fallback = useCallback((): HTMLElement | null => {
    return (
      enabled(filtri.current) ?? firstDrawn([...chips.current.values()].map(enabled)) ?? root.current
    );
  }, []);

  /** Focus to `target`'s chip if it is drawn — the first chip for {@link FIRST_CHIP} — else to `Filtri`. */
  const focusChip = useCallback(
    (target: string | null) => {
      const chip =
        target === FIRST_CHIP
          ? firstDrawn([...chips.current.values()].map(enabled))
          : target === null
            ? null
            : enabled(chips.current.get(target));

      (chip ?? fallback())?.focus();
    },
    [fallback],
  );

  /** Focus `target` once the bar reads `after`, the state a change leaves. */
  const focusOnceShown = useCallback(
    (after: string, target: string | null) => {
      if (after === stateKey) {
        focusChip(target);

        return;
      }
      pending.current = { target, state: after };
    },
    [stateKey, focusChip],
  );

  useEffect(() => {
    const waiting = pending.current;

    if (waiting === null || waiting.state !== stateKey) return;
    pending.current = null;
    focusChip(waiting.target);
  }, [stateKey, focusChip]);

  // After the Dialog's own effect has shown it (a child's effect runs first):
  // the field asked for takes focus, else the first.
  useEffect(() => {
    if (!sheetOpen) return;

    const asked = sheetField === null ? null : drawn(fields.current.get(sheetField));
    const first = firstDrawn([...fields.current.values()]);

    (asked ?? first)?.focus();
  }, [sheetOpen, sheetField]);

  // Every way the sheet closes returns focus to `Filtri`, after the native
  // close has put it back on whatever opened the sheet — unless focus has
  // already gone on elsewhere on the page, which it then keeps.
  useEffect(() => {
    if (sheetOpen) {
      wasOpen.current = true;

      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;

    const active = document.activeElement;

    if (active !== null && active !== document.body && root.current?.contains(active) !== true) return;
    fallback()?.focus();
  }, [sheetOpen, fallback]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  useCloseWhenCrossing(sheetOpen, closeSheet);

  /** Opens the sheet from `opener`: a chip's key, its field taking focus, or `null` for `Filtri`. */
  function openSheet(opener: string | null): void {
    setSheetField(opener);
    setSheetOpen(true);
  }

  /** Whether the sheet is open and `opener` (a chip's key, `null` for `Filtri`) opened it. */
  function expandedBy(opener: string | null): boolean {
    return sheetOpen && sheetField === opener;
  }

  function chipRef(key: string): (element: HTMLButtonElement | null) => void {
    return (element) => {
      chips.current.set(key, element);
    };
  }

  function fieldRef(key: string): (element: HTMLButtonElement | null) => void {
    return (element) => {
      fields.current.set(key, element);
    };
  }

  return {
    root,
    filtri,
    sheetOpen,
    sheetId,
    titleId,
    focusChip,
    focusOnceShown,
    openSheet,
    closeSheet,
    expandedBy,
    chipRef,
    fieldRef,
  };
}

/**
 * THE FILTER BAR of *Kalendar*'s *Sve smjene* and of *Sati*'s organization
 * table (stories 7.5, 15.7), under the month toolbar: one summary card — what
 * is shown as the `role="status"` line, and `Filtri` with the count of
 * filters on — then one removable chip per active filter (`Smjena: B ✕`) and
 * `Očisti sve`, and the *Filtri* sheet, where each filter's value is picked
 * in a searchable list. The same at every width: the sheet docks at the
 * bottom below 1024 px and at the side from it. Every change is the screen's
 * `onChange`, which writes the URL at once.
 *
 * PRESENTATIONAL: the model (`@/utils/filter-bar`) decides the chips, the
 * summary, what a press changes — a person replacing the team in *Kalendar*,
 * the two combining in *Sati* — and where focus goes after a ✕.
 */
export function FilterBar({
  model,
  onChange,
  handle,
}: {
  readonly model: FilterBarModel;
  readonly onChange: (change: FilterChange) => void;
  readonly handle?: Ref<FilterBarHandle>;
}): ReactNode {
  const state = modelStateKeyOf(model);
  const bar = useFilterBarState(state);
  const { focusOnceShown } = bar;

  /** Make `change`, and focus `target` once the model shows it. */
  const changeThenFocus = useCallback(
    (change: FilterChange, target: string | null) => {
      const after = filterStateKeyOf(change);

      focusOnceShown(after, target);
      if (after !== state) onChange(change);
    },
    [state, focusOnceShown, onChange],
  );

  useImperativeHandle(
    handle,
    () => ({
      changeAndFocusFirst: (change) => {
        changeThenFocus(change, FIRST_CHIP);
      },
    }),
    [changeThenFocus],
  );

  return (
    <div ref={bar.root} tabIndex={-1} className="min-w-0 px-4 pb-4 outline-none">
      <div role="group" aria-label={t('filter.label')} className="grid min-w-0 gap-2">
      <FilterSummaryCard
        summary={t(filterSummaryMessageKey(model.summary), filterSummaryValuesOf(model.summary))}
        activeCount={model.activeCount}
        expanded={bar.expandedBy(null)}
        sheetId={bar.sheetId}
        filtriRef={bar.filtri}
        onOpen={() => {
          bar.openSheet(null);
        }}
      />
      <ActiveChips
        chips={activeChipsOf(model).map((chip) => ({
          key: chip.key,
          text: t(filterChipMessageKey(chip), { value: chip.value }),
          removeLabel: t(filterRemoveMessageKey(chip), { value: chip.value }),
        }))}
        showClear={hasActiveFilter(model)}
        expandedBy={bar.expandedBy}
        sheetId={bar.sheetId}
        chipRef={bar.chipRef}
        onOpen={bar.openSheet}
        onRemove={(key) => {
          changeThenFocus(filterRemovalOf(model, key), focusAfterRemovalOf(model, key));
        }}
        onClear={() => {
          changeThenFocus(FILTERS_CLEARED, null);
        }}
      />
      </div>
      <SheetDialog id={bar.sheetId} titleId={bar.titleId} open={bar.sheetOpen} onClose={bar.closeSheet} side>
        {bar.sheetOpen ? (
          <FilterSheetContent
            titleId={bar.titleId}
            model={model}
            fieldRef={bar.fieldRef}
            onClose={bar.closeSheet}
            onChange={onChange}
          />
        ) : null}
      </SheetDialog>
    </div>
  );
}

/**
 * The bar's summary as one line of text while a filter is on, and `null`
 * with none: what the phone's sticky head repeats once the bar has scrolled
 * under it (`StickyHead`, deferred-work E816).
 */
export function activeFilterSummaryOf(model: FilterBarModel): string | null {
  return hasActiveFilter(model) ? t(filterSummaryMessageKey(model.summary), filterSummaryValuesOf(model.summary)) : null;
}

/**
 * THE SUMMARY CARD (story 15.7): an opaque reading Card — never glass — with
 * an icon, the muted tabular summary as the `role="status"` line, and
 * `Filtri`, at least 44 px, with a Badge counting the filters on (none with
 * none on; never `destructive`). `leading` (a search) and `trailing` (a sort)
 * share its row, each on its own row below 640 px where the screen asks.
 */
export function FilterSummaryCard({
  summary,
  activeCount,
  expanded,
  sheetId,
  filtriRef,
  disabled = false,
  describedBy,
  leading,
  trailing,
  onOpen,
}: {
  readonly summary: string;
  readonly activeCount: number;
  /** The sheet is open, and `Filtri` opened it. */
  readonly expanded: boolean;
  readonly sheetId: string;
  readonly filtriRef: RefObject<HTMLButtonElement | null>;
  readonly disabled?: boolean;
  /** The id of what describes `Filtri` — the screen's refusal while one is shown. */
  readonly describedBy?: string | undefined;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onOpen: () => void;
}): ReactNode {
  const badge = filterBadgeCountOf(activeCount);

  return (
    <Card className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-2">
      {leading}
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-3 pl-2">
        <Users aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <p role="status" className="min-w-0 py-1 text-sm text-muted-foreground tabular-nums">
          {summary}
        </p>
      </div>
      <Button
        ref={filtriRef}
        type="button"
        variant="outline"
        className="h-11 shrink-0"
        aria-label={badge === null ? undefined : t('filter.openActive', { count: badge })}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={expanded ? sheetId : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={onOpen}
      >
        <FunnelSimple aria-hidden />
        {t('filter.open')}
        {badge === null ? null : (
          <Badge aria-hidden className="tabular-nums">
            {badge}
          </Badge>
        )}
      </Button>
      {trailing}
    </Card>
  );
}

/** One active chip, ready to draw: its key, `Ključ: vrijednost`, and its ✕'s name. */
export interface ActiveChipView<K extends string = string> {
  readonly key: K;
  readonly text: string;
  readonly removeLabel: string;
}

/**
 * THE ACTIVE CHIPS under the summary card (story 15.7): one per filter on,
 * read by its words and its ✕, never by colour. The chip's body opens the
 * sheet at that filter's field; its ✕ (44 px) removes it. `Očisti sve`
 * follows while `showClear`. Nothing is drawn with no chip and nothing to clear.
 */
export function ActiveChips<K extends string>({
  chips,
  showClear,
  expandedBy,
  sheetId,
  disabled = false,
  describedBy,
  chipRef,
  onOpen,
  onRemove,
  onClear,
}: {
  readonly chips: readonly ActiveChipView<K>[];
  readonly showClear: boolean;
  /** Whether the sheet is open and the chip `key` opened it: only that chip says so. */
  readonly expandedBy: (key: K) => boolean;
  readonly sheetId: string;
  readonly disabled?: boolean;
  readonly describedBy?: string | undefined;
  readonly chipRef: (key: string) => (element: HTMLButtonElement | null) => void;
  readonly onOpen: (key: K) => void;
  readonly onRemove: (key: K) => void;
  readonly onClear: () => void;
}): ReactNode {
  if (chips.length === 0 && !showClear) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <div
          key={chip.key}
          className="inline-flex min-w-0 max-w-full items-center rounded-full border-[1.5px] border-primary bg-primary/10"
        >
          <Button
            ref={chipRef(chip.key)}
            type="button"
            variant="ghost"
            className="h-11 min-w-0 rounded-full pl-4 pr-1 font-semibold"
            aria-haspopup="dialog"
            aria-expanded={expandedBy(chip.key)}
            aria-controls={expandedBy(chip.key) ? sheetId : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={() => {
              onOpen(chip.key);
            }}
          >
            <span className="truncate">{chip.text}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-11 shrink-0 rounded-full p-0"
            aria-label={chip.removeLabel}
            aria-describedby={describedBy}
            disabled={disabled}
            onClick={() => {
              onRemove(chip.key);
            }}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
      {showClear ? (
        <Button type="button" variant="link" className="h-11 px-2" disabled={disabled} onClick={onClear}>
          {t('filter.clearAll')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * ONE FIELD OF THE *Filtri* SHEET (story 15.7): its label and a button with
 * the value chosen, which opens the picker in the opaque `Popover` — never a
 * glass one inside the glass sheet. Escape closes only the picker (the
 * Popover cancels it before the sheet hears it) and puts focus back on the
 * field, as a pick does; tabbing out closes it where focus went.
 * `picker(done)` is the picker's content; `done` closes it.
 */
export function FilterField({
  label,
  value,
  pickerLabel,
  disabled = false,
  fieldRef,
  picker,
}: {
  readonly label: string;
  readonly value: string;
  readonly pickerLabel: string;
  readonly disabled?: boolean;
  readonly fieldRef: (element: HTMLButtonElement | null) => void;
  readonly picker: (done: () => void) => ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const labelId = useId();
  const valueId = useId();
  const pickerId = useId();

  const done = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  const shown = open && !disabled;

  // An open picker keeps its field in view in the sheet's own scroll.
  useEffect(() => {
    if (shown) region.current?.scrollIntoView(KEEP_IN_VIEW);
  }, [shown]);

  /** The value button, for `done` and for the bar, which focuses a field as the sheet opens. */
  function setButton(element: HTMLButtonElement | null): void {
    button.current = element;
    fieldRef(element);
  }

  /** Focus leaving the field and its picker closes the picker where focus went. */
  function closeOnLeave(event: FocusEvent<HTMLDivElement>): void {
    const to = event.relatedTarget;

    if (shown && to !== null && !event.currentTarget.contains(to)) setOpen(false);
  }

  return (
    <div ref={region} className="relative grid min-w-0 gap-1.5" onBlur={closeOnLeave}>
      <span id={labelId} className="font-sans text-sm font-semibold">
        {label}
      </span>
      <Button
        ref={setButton}
        type="button"
        variant="outline"
        className="h-11 w-full min-w-0 justify-between gap-2 font-normal"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="dialog"
        aria-expanded={shown}
        aria-controls={shown ? pickerId : undefined}
        disabled={disabled}
        onClick={() => {
          if (shown) done();
          else setOpen(true);
        }}
      >
        <span id={valueId} className="truncate">
          {value}
        </span>
        <CaretDown aria-hidden />
      </Button>
      <Popover
        id={pickerId}
        open={shown}
        onClose={done}
        region={region}
        aria-label={pickerLabel}
        className="right-0 w-auto"
        opaque
      >
        {picker(done)}
      </Popover>
    </div>
  );
}

/** What focuses a picker list's tab stop, once the list has drawn: ↓ from its search. */
type EnterList = (() => void) | null;

/** One option of a picker list: its id (`null`: all), its name, and the count beside it, if any. */
export interface PickerOption {
  readonly id: string | null;
  readonly name: string;
  readonly count: string | null;
  /** The heading drawn above it, where a group starts. */
  readonly group: string | null;
}

/**
 * A picker's list: `Button`s with `aria-pressed` on the chosen one, one tab
 * stop that ↑ ↓ Home End move (as the month picker's grid), and a heading
 * above each group. Opening focuses the chosen option when `focusOnOpen`.
 * A character typed on the list goes to `onType` (its search).
 */
export function OptionList({
  options,
  chosen,
  focusOnOpen,
  onPick,
  enterRef,
  onType,
}: {
  readonly options: readonly PickerOption[];
  readonly chosen: string | null;
  readonly focusOnOpen: boolean;
  readonly onPick: (id: string | null) => void;
  /** Set to what focuses the list's tab stop: ↓ from the search. */
  readonly enterRef?: RefObject<EnterList>;
  readonly onType?: () => void;
}): ReactNode {
  const chosenIndex = Math.max(
    options.findIndex((option) => option.id === chosen),
    0,
  );
  // THE TAB STOP IS AN OPTION, NOT A PLACE: tracked by id, so a search that
  // narrows the list never leaves it on a row that moved or is gone; an option
  // filtered away falls back to the chosen one, else the first.
  const [cursor, setCursor] = useState<string | null>(chosen);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const cursorIndex = options.findIndex((option) => option.id === cursor);
  const at = cursorIndex === -1 ? chosenIndex : cursorIndex;
  // On opening only: the chosen option takes focus, as the month picker's month does.
  const opened = useRef(focusOnOpen);

  useEffect(() => {
    if (!opened.current) return;
    opened.current = false;
    buttons.current[chosenIndex]?.focus();
  }, [chosenIndex]);

  useEffect(() => {
    if (enterRef === undefined) return;
    enterRef.current = () => buttons.current[at]?.focus();
  });

  /** The ref of the option at `index`, so focus can follow the keys. */
  function register(index: number): (element: HTMLButtonElement | null) => void {
    return (element) => {
      buttons.current[index] = element;
    };
  }

  function moveOnKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (onType !== undefined && typesIntoSearch(event.key, event.ctrlKey || event.metaKey || event.altKey)) {
      onType();

      return;
    }

    const to = pickerIndexAfter(event.key, at, options.length);

    if (to === null) return;
    event.preventDefault();
    setCursor(options[to]?.id ?? null);
    buttons.current[to]?.focus();
  }

  return (
    <div
      role="presentation"
      className="grid max-h-[min(18rem,38dvh)] gap-0.5 overflow-y-auto overscroll-contain"
      onKeyDown={moveOnKey}
    >
      {options.map((option, index) => (
        <div key={option.id ?? ALL_TEAMS_OPTION} className="grid">
          {option.group === null ? null : (
            <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {option.group}
            </p>
          )}
          <Button
            ref={register(index)}
            type="button"
            variant="ghost"
            className="group h-auto min-h-11 justify-between gap-3 whitespace-normal px-2 py-2 text-left font-normal aria-pressed:bg-primary/10 aria-pressed:font-semibold"
            tabIndex={index === at ? 0 : -1}
            aria-pressed={option.id === chosen}
            onFocus={() => {
              setCursor(option.id);
            }}
            onClick={() => {
              onPick(option.id);
            }}
          >
            <span className="min-w-0 break-words">{option.name}</span>
            {option.count === null ? null : (
              // Muted on a plain row; `foreground` on the pressed one, whose
              // `primary`/10 tint leaves muted text under 4.5:1 (story 15.2,
              // measured in `theme-contrast`).
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums group-aria-pressed:text-foreground">
                {option.count}
              </span>
            )}
          </Button>
        </div>
      ))}
    </div>
  );
}

/**
 * A SEARCHABLE PICKER (story 15.7, the Command list of the *Filtri* sheet,
 * without `cmdk`): a labelled search that narrows the list as it is typed —
 * case and diacritics ignored (`optionsMatching`) — over {@link OptionList}.
 * Every opening starts with an empty search and focus on the chosen option;
 * ↓ from the search enters the list, and a character typed on the list goes
 * to the search. `pinned` (`Sve smjene (4)`) is listed whatever is typed; with
 * nothing else matching, a muted `Nema rezultata` says so. `options(matching)`
 * builds the rows from what matches, so a group heading follows the search.
 */
export function SearchableOptions<T>({
  searchLabel,
  items,
  nameOf,
  rowsOf,
  pinned = null,
  keep,
  chosen,
  note,
  onPick,
}: {
  readonly searchLabel: string;
  readonly items: readonly T[];
  readonly nameOf: (item: T) => string;
  readonly rowsOf: (matching: readonly T[]) => readonly PickerOption[];
  readonly pinned?: PickerOption | null;
  /** An item listed whatever is typed, in its place: an option bar's "all" (`sve`, `svi`). */
  readonly keep?: (item: T) => boolean;
  readonly chosen: string | null;
  /** Under the search, live: `1 od 17` on the Osoba picker. */
  readonly note?: (matching: readonly T[]) => string;
  readonly onPick: (id: string | null) => void;
}): ReactNode {
  const [query, setQuery] = useState(NO_SEARCH);
  const searchId = useId();
  const enter = useRef<EnterList>(null);
  const search = useRef<HTMLInputElement>(null);
  const matching = optionsMatching(items, query, nameOf);
  const kept = keep === undefined ? matching : items.filter((item) => keep(item) || matching.includes(item));
  const rows = rowsOf(kept);
  // Nothing BUT the pinned or kept rows matches what was typed.
  const noMatch = query.trim() !== NO_SEARCH && matching.every((item) => keep?.(item) === true);

  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={searchId}>{searchLabel}</Label>
      <Input
        ref={search}
        id={searchId}
        type="search"
        autoComplete="off"
        className="h-11"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (!entersPickerList(event.key)) return;
          event.preventDefault();
          enter.current?.();
        }}
      />
      {note === undefined ? null : (
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {note(matching)}
        </p>
      )}
      <OptionList
        options={pinned === null ? rows : [pinned, ...rows]}
        chosen={chosen}
        focusOnOpen
        onPick={onPick}
        enterRef={enter}
        onType={() => search.current?.focus()}
      />
      {/* Where the results would be, after the pinned row; always mounted, so it is announced. */}
      <p role="status" className="px-2 text-sm text-muted-foreground empty:hidden">
        {noMatch ? t('filter.noMatch') : null}
      </p>
    </div>
  );
}

/** The Smjena picker: `Sve smjene (4)`, then every team under *Smjene*, each with its person count. */
function TeamOptions({
  model,
  onPick,
}: {
  readonly model: FilterBarModel;
  readonly onPick: (id: string | null) => void;
}): ReactNode {
  return (
    <SearchableOptions
      searchLabel={t('filter.optionSearch', { label: t('filter.team') })}
      items={model.teams}
      nameOf={(team) => team.name}
      rowsOf={(matching) =>
        matching.map((team, index) => ({
          id: team.id,
          name: team.name,
          count: t('filter.personCount', { count: team.count }),
          group: index === 0 ? t('filter.teamGroup') : null,
        }))
      }
      pinned={{ id: null, name: t('filter.allTeams', { count: model.teams.length }), count: null, group: null }}
      chosen={teamPickedOf(model)}
      onPick={onPick}
    />
  );
}

/**
 * The Osoba picker: `Traži osobu (17)`, `{n} od {total}`, `Sve osobe`, then
 * the people grouped by their team for the month, `Bez smjene` last.
 */
function PersonOptions({
  model,
  onPick,
}: {
  readonly model: FilterBarModel;
  readonly onPick: (id: string | null) => void;
}): ReactNode {
  return (
    <SearchableOptions
      searchLabel={t('filter.search', { count: model.people.length })}
      items={model.people}
      nameOf={(person) => person.name}
      rowsOf={(matching) =>
        peopleGroupsOf(matching, model.teams).flatMap((group) =>
          group.people.map((person, index) => ({
            id: person.id,
            name: person.name,
            count: null,
            group: index === 0 ? (group.teamName ?? t('filter.noTeam')) : null,
          })),
        )
      }
      pinned={{ id: null, name: t('filter.allPeople', { count: model.people.length }), count: null, group: null }}
      chosen={model.person}
      note={(matching) =>
        t('filter.matches', { shown: matching.length, total: model.people.length })
      }
      onPick={onPick}
    />
  );
}

/**
 * The *Filtri* sheet's content, mounted for each opening: the Smjena and
 * Osoba fields — in *Kalendar* with the note that a person replaces the team
 * — and `Poništi` and a live `Prikaži {n} osoba`. Every pick writes the URL
 * at once, so Back works; the sheet stays open until `Prikaži…`, Escape, its
 * close or a crossing of 1024 px.
 */
function FilterSheetContent({
  titleId,
  model,
  fieldRef,
  onClose,
  onChange,
}: {
  readonly titleId: string;
  readonly model: FilterBarModel;
  readonly fieldRef: (key: string) => (element: HTMLButtonElement | null) => void;
  readonly onClose: () => void;
  readonly onChange: (change: FilterChange) => void;
}): ReactNode {
  // THE FIELDS SAY WHAT THE CHIPS SAY: a filter on reads the chip's value; in
  // *Kalendar* a person replacing the team reads so, as the picker marks no
  // team; only with no filter does a field read `Sve …`.
  const chipValue = (key: FilterKey): string | null => model.chips.find((chip) => chip.key === key)?.value ?? null;
  const teamValue =
    chipValue(FILTER_TEAM) ??
    (teamPickedOf(model) === NO_TEAM_OPTION ? t('filter.teamReplaced') : t('filter.allTeams', { count: model.teams.length }));
  const personValue = chipValue(FILTER_PERSON) ?? t('filter.allPeople', { count: model.people.length });

  return (
    <>
      <SheetHeader titleId={titleId} onClose={onClose} />
      <FilterField
        label={t('filter.team')}
        value={teamValue}
        pickerLabel={t('filter.teamPicker')}
        fieldRef={fieldRef(FILTER_TEAM)}
        picker={(done) => (
          <TeamOptions
            model={model}
            onPick={(id) => {
              onChange(filterChoiceOf(model, FILTER_TEAM, id));
              done();
            }}
          />
        )}
      />
      <div className="grid min-w-0 gap-2">
        <FilterField
          label={t('filter.person')}
          value={personValue}
          pickerLabel={t('filter.personPicker')}
          fieldRef={fieldRef(FILTER_PERSON)}
          picker={(done) => (
            <PersonOptions
              model={model}
              onPick={(id) => {
                onChange(filterChoiceOf(model, FILTER_PERSON, id));
                done();
              }}
            />
          )}
        />
        {model.combine ? null : <p className="text-sm text-muted-foreground">{t('filter.replaceNote')}</p>}
      </div>
      <SheetFooter
        shownCount={model.shownCount}
        onReset={() => {
          onChange(FILTERS_CLEARED);
        }}
        onClose={onClose}
      />
    </>
  );
}

/**
 * A sheet on the native `Dialog`: docked to the bottom edge (the month
 * picker's on a phone), or with `side` the *Filtri* sheet, at the bottom below
 * 1024 px and at the right from it.
 */
export function SheetDialog({
  id,
  titleId,
  open,
  side = false,
  onClose,
  children,
}: {
  readonly id: string;
  readonly titleId: string;
  readonly open: boolean;
  readonly side?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Dialog
      id={id}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      aria-labelledby={titleId}
      docked
      side={side}
    >
      {children}
    </Dialog>
  );
}

/** The sheet's title, `Filtri`, and its close. */
export function SheetHeader({ titleId, onClose }: { readonly titleId: string; readonly onClose: () => void }): ReactNode {
  return (
    <DialogHeader closeLabel={t('filter.sheetClose')} onClose={onClose}>
      <DialogTitle id={titleId}>{t('filter.sheetTitle')}</DialogTitle>
    </DialogHeader>
  );
}

/** The sheet's `Poništi`, and `Prikaži {n} osoba`, which closes it. */
export function SheetFooter({
  shownCount,
  onReset,
  onClose,
}: {
  readonly shownCount: number;
  readonly onReset: () => void;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <DialogFooter className="flex-row [&>*]:flex-1">
      <Button type="button" variant="outline" className="h-11" onClick={onReset}>
        {t('filter.sheetReset')}
      </Button>
      <Button type="button" className="h-11" onClick={onClose}>
        {t('filter.sheetShow', { count: shownCount })}
      </Button>
    </DialogFooter>
  );
}
