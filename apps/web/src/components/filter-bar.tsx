import { ChevronDown, X } from 'lucide-react';
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

import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover } from '@/components/ui/popover';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { useCloseWhenWide, usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import {
  ALL_TEAMS_OPTION,
  FILTERS_CLEARED,
  FILTER_PERSON,
  FILTER_TEAM,
  NO_SEARCH,
  entersPickerList,
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
  peopleGroupsOf,
  peopleMatching,
  pickerIndexAfter,
  teamOptionChoiceOf,
  teamOptionOf,
  type FilterBarModel,
  type FilterChange,
  type FilterChip,
  type FilterKey,
  type OptionPickerAlign,
} from '@/utils/filter-bar';

/**
 * What a screen can ask of the bar: make `change`, and once the model shows
 * it, put focus on the first chip — or on `Filtri` where that chip is not
 * drawn. The empty *Sati* table's two ways out use it.
 */
export interface FilterBarHandle {
  changeAndFocusFirst(change: FilterChange): void;
}

/** An element focus can actually land on: in the document and drawn (a phone hides inactive chips). */
export function drawn(element: HTMLElement | null | undefined): HTMLElement | null {
  return element !== null && element !== undefined && element.isConnected && element.getClientRects().length > 0
    ? element
    : null;
}

/** Focus waiting for the model a change leaves: the chip to take it, and the state that must render first. */
interface PendingFocus {
  readonly key: FilterKey;
  readonly state: string;
}

/**
 * THE FILTER BAR of *Kalendar*'s *Sve smjene* and of *Sati*'s organization
 * table (story 7.5), under the month toolbar: two chips, Smjena and Osoba,
 * each `Ključ: vrijednost ▾`, an active one with its own ✕, and the summary
 * line that says what is shown, ending in `Poništi filtre` while a filter is
 * on. It never leaves the screen: every change is the screen's `onChange`,
 * which writes the URL at once.
 *
 * PRESENTATIONAL: the model (`@/utils/filter-bar`) decides the chips, the
 * summary, what a press changes — a person replacing the team in *Kalendar*,
 * the two combining in *Sati* — and where focus goes after a ✕.
 *
 * FOCUS WAITS FOR THE CHANGE: a ✕, `Poništi filtre` or a pick records which
 * chip should take focus and the state the change leaves, and an effect moves
 * focus once the model reads that state — so it lands on what the re-render
 * draws (the Smjena chip coming back in *Kalendar*), never on a chip the
 * re-render hides (an inactive chip on a phone), with `Filtri` the fallback.
 *
 * From 640 px a chip opens its picker in the shared `Popover`. Below it the
 * inactive chips are not drawn, and `Filtri · N` — or an active chip — opens a
 * bottom sheet on the native `Dialog` with both pickers and a live
 * `Prikaži {n} osoba`; the sheet closes on that button, on Escape and when the
 * viewport turns wide, and an open picker closes when it turns narrow.
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
  const isPhone = usePhone();
  const [open, setOpen] = useState<FilterKey | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Every opening of the sheet remounts its content: the search starts empty.
  const [opening, setOpening] = useState(0);
  const sheetId = useId();
  const chips = useRef(new Map<FilterKey, HTMLButtonElement | null>());
  const filtri = useRef<HTMLButtonElement>(null);
  const pending = useRef<PendingFocus | null>(null);
  const active = hasActiveFilter(model);
  const state = modelStateKeyOf(model);

  /** Focus to `key`'s chip if it is drawn, else to `Filtri`. */
  const focusChip = useCallback((key: FilterKey) => {
    (drawn(chips.current.get(key)) ?? drawn(filtri.current))?.focus();
  }, []);

  /** Make `change`, and focus `key`'s chip once the model shows it. */
  const changeThenFocus = useCallback(
    (change: FilterChange, key: FilterKey) => {
      const after = filterStateKeyOf(change);

      if (after === state) {
        focusChip(key);

        return;
      }
      pending.current = { key, state: after };
      onChange(change);
    },
    [state, focusChip, onChange],
  );

  useEffect(() => {
    const waiting = pending.current;

    if (waiting === null || waiting.state !== state) return;
    pending.current = null;
    focusChip(waiting.key);
  }, [state, focusChip]);

  useImperativeHandle(
    handle,
    () => ({
      changeAndFocusFirst: (change) => {
        changeThenFocus(change, FILTER_TEAM);
      },
    }),
    [changeThenFocus],
  );

  // A picker belongs to a wide viewport: turning narrow closes it.
  useEffect(() => {
    if (isPhone) setOpen(null);
  }, [isPhone]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  useCloseWhenWide(sheetOpen, closeSheet);

  function openSheet(): void {
    setOpening((count) => count + 1);
    setSheetOpen(true);
  }

  function register(key: FilterKey): (element: HTMLButtonElement | null) => void {
    return (element) => {
      chips.current.set(key, element);
    };
  }

  function remove(key: FilterKey): void {
    setOpen(null);
    changeThenFocus(filterRemovalOf(model, key), focusAfterRemovalOf(model, key));
  }

  function clear(): void {
    setOpen(null);
    changeThenFocus(FILTERS_CLEARED, FILTER_TEAM);
  }

  function closePicker(key: FilterKey): void {
    setOpen(null);
    focusChip(key);
  }

  return (
    <div className="grid min-w-0 gap-1 px-4 pb-4">
      <div role="group" aria-label={t('filter.label')} className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          ref={filtri}
          type="button"
          variant="outline"
          className="h-11 sm:hidden"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-controls={sheetOpen ? sheetId : undefined}
          onClick={openSheet}
        >
          {model.activeCount === 0 ? t('filter.open') : t('filter.openCount', { count: model.activeCount })}
        </Button>
        {model.chips.map((chip) => (
          <Chip
            key={chip.key}
            chip={chip}
            model={model}
            open={open === chip.key}
            expanded={isPhone ? sheetOpen : open === chip.key}
            controls={isPhone ? (sheetOpen ? sheetId : null) : null}
            chipRef={register(chip.key)}
            onToggle={() => {
              if (isPhone) openSheet();
              else if (open === chip.key) closePicker(chip.key);
              else setOpen(chip.key);
            }}
            onClose={() => {
              closePicker(chip.key);
            }}
            onLeave={() => {
              setOpen(null);
            }}
            onPick={(id) => {
              setOpen(null);
              changeThenFocus(filterChoiceOf(model, chip.key, id), chip.key);
            }}
            onRemove={() => {
              remove(chip.key);
            }}
          />
        ))}
      </div>
      <SummaryLine
        text={t(filterSummaryMessageKey(model.summary), filterSummaryValuesOf(model.summary))}
        showClear={active}
        onClear={clear}
      />
      <FilterSheet
        id={sheetId}
        opening={opening}
        model={model}
        open={sheetOpen}
        onClose={closeSheet}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * The summary line under a bar: what is shown, `role="status"`, ending in
 * `Poništi filtre` while there is something to clear.
 */
export function SummaryLine({
  text,
  showClear,
  onClear,
}: {
  readonly text: string;
  readonly showClear: boolean;
  readonly onClear: () => void;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3">
      <p role="status" className="min-w-0 py-1 text-sm text-muted-foreground tabular-nums">
        {text}
      </p>
      {showClear ? (
        <Button type="button" variant="link" className="h-11 px-0" onClick={onClear}>
          {t('filter.clear')}
        </Button>
      ) : null}
    </div>
  );
}

/** One chip of *Kalendar*'s or *Sati*'s bar: the shared frame, with its words and its picker. */
function Chip({
  chip,
  model,
  open,
  expanded,
  controls,
  chipRef,
  onToggle,
  onClose,
  onLeave,
  onPick,
  onRemove,
}: {
  readonly chip: FilterChip;
  readonly model: FilterBarModel;
  readonly open: boolean;
  readonly expanded: boolean;
  readonly controls: string | null;
  readonly chipRef: (element: HTMLButtonElement | null) => void;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly onLeave: () => void;
  readonly onPick: (id: string | null) => void;
  readonly onRemove: () => void;
}): ReactNode {
  return (
    <ChipFrame
      open={open}
      expanded={expanded}
      controls={controls}
      chipRef={chipRef}
      onToggle={onToggle}
      onClose={onClose}
      onLeave={onLeave}
      onRemove={onRemove}
      text={t(filterChipMessageKey(chip), { value: chip.value })}
      active={chip.value !== null}
      removeLabel={t(filterRemoveMessageKey(chip), { value: chip.value })}
      pickerLabel={chip.key === FILTER_TEAM ? t('filter.teamPicker') : t('filter.personPicker')}
    >
      {chip.key === FILTER_TEAM ? (
        <TeamOptions model={model} onPick={onPick} />
      ) : (
        <PersonOptions model={model} onPick={onPick} autoFocus />
      )}
    </ChipFrame>
  );
}

export interface ChipFrameProps {
  /** `Ključ: vrijednost`. */
  readonly text: string;
  /** Set: drawn active, with its ✕; an unset chip is not drawn below 640 px. */
  readonly active: boolean;
  /** The ✕'s name, saying what it removes. */
  readonly removeLabel: string;
  /** The picker's name. */
  readonly pickerLabel: string;
  /** Which edge of the chip the picker opens under, from 640 px; the left by default. */
  readonly pickerAlign?: OptionPickerAlign;
  /** The picker is open (from 640 px). */
  readonly open: boolean;
  /** What the chip opened is open: its picker, or on a phone the sheet. */
  readonly expanded: boolean;
  /** The sheet's id while a phone's chip opened it; the picker's is the chip's own. */
  readonly controls: string | null;
  readonly disabled?: boolean;
  /** The id of what describes the chip — the screen's refusal while one is shown. */
  readonly describedBy?: string | undefined;
  readonly chipRef: (element: HTMLButtonElement | null) => void;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly onLeave: () => void;
  readonly onRemove: () => void;
  /** The picker's content. */
  readonly children: ReactNode;
}

/** One chip: the button that opens its picker, its ✕ while active, and the picker. */
export function ChipFrame({
  text,
  active,
  removeLabel,
  pickerLabel,
  pickerAlign,
  open,
  expanded,
  controls,
  disabled = false,
  describedBy,
  chipRef,
  onToggle,
  onClose,
  onLeave,
  onRemove,
  children,
}: ChipFrameProps): ReactNode {
  const region = useRef<HTMLDivElement>(null);
  const pickerId = useId();

  /** Focus leaving the chip and its picker closes the picker where focus went. */
  function closeOnLeave(event: FocusEvent<HTMLDivElement>): void {
    const to = event.relatedTarget;

    if (open && to !== null && !event.currentTarget.contains(to)) onLeave();
  }

  return (
    <div
      ref={region}
      data-active={active}
      className="relative inline-flex min-w-0 max-w-full items-center rounded-full border-[1.5px] border-input bg-card data-[active=false]:max-sm:hidden data-[active=true]:border-primary data-[active=true]:bg-primary/10"
      onBlur={closeOnLeave}
    >
      <Button
        ref={chipRef}
        type="button"
        variant="ghost"
        className="h-11 min-w-0 gap-1 rounded-full pl-4 pr-3 font-normal data-[active=true]:font-semibold"
        data-active={active}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={open ? pickerId : (controls ?? undefined)}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="truncate">{text}</span>
        <ChevronDown aria-hidden />
      </Button>
      {active ? (
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-11 shrink-0 rounded-full p-0"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      ) : null}
      <Popover
        id={pickerId}
        open={open}
        onClose={onClose}
        region={region}
        aria-label={pickerLabel}
        data-align={pickerAlign}
        className="w-72 sm:data-[align=end]:left-auto sm:data-[align=end]:right-0"
      >
        {children}
      </Popover>
    </div>
  );
}

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
 * above each group. Opening focuses the chosen option when `autoFocus`.
 */
export function OptionList({
  options,
  chosen,
  autoFocus,
  onPick,
  enterRef,
}: {
  readonly options: readonly PickerOption[];
  readonly chosen: string | null;
  readonly autoFocus: boolean;
  readonly onPick: (id: string | null) => void;
  /** Set to what focuses the list's tab stop: ↓ from the Osoba search. */
  readonly enterRef?: RefObject<(() => void) | null>;
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
  const opened = useRef(autoFocus);

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
    const to = pickerIndexAfter(event.key, at, options.length);

    if (to === null) return;
    event.preventDefault();
    setCursor(options[to]?.id ?? null);
    buttons.current[to]?.focus();
  }

  return (
    <div className="grid max-h-72 gap-0.5 overflow-y-auto" onKeyDown={moveOnKey}>
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
            className="h-auto min-h-11 justify-between gap-3 whitespace-normal px-2 py-2 text-left font-normal aria-pressed:bg-primary/10 aria-pressed:font-semibold"
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
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{option.count}</span>
            )}
          </Button>
        </div>
      ))}
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
  const options: PickerOption[] = [
    { id: null, name: t('filter.allTeams', { count: model.teams.length }), count: null, group: null },
    ...model.teams.map((team, index) => ({
      id: team.id,
      name: team.name,
      count: t('filter.personCount', { count: team.count }),
      group: index === 0 ? t('filter.teamGroup') : null,
    })),
  ];

  return <OptionList options={options} chosen={model.team} autoFocus onPick={onPick} />;
}

/**
 * The Osoba picker: a labelled search that filters the list as it is typed,
 * `{n} od {total}`, `Sve osobe`, then the people grouped by their team for
 * the month, `Bez smjene` last. ↓ from the search enters the list.
 */
function PersonOptions({
  model,
  onPick,
  autoFocus = false,
}: {
  readonly model: FilterBarModel;
  readonly onPick: (id: string | null) => void;
  readonly autoFocus?: boolean;
}): ReactNode {
  const [query, setQuery] = useState(NO_SEARCH);
  const searchId = useId();
  const enter = useRef<(() => void) | null>(null);
  const search = useRef<HTMLInputElement>(null);
  // On opening only: the search takes focus.
  const opened = useRef(autoFocus);

  useEffect(() => {
    if (!opened.current) return;
    opened.current = false;
    search.current?.focus();
  }, []);

  const matching = peopleMatching(model.people, query);
  const groups = peopleGroupsOf(matching, model.teams);
  const options: PickerOption[] = [
    { id: null, name: t('filter.allPeople', { count: model.people.length }), count: null, group: null },
    ...groups.flatMap((group) =>
      group.people.map((person, index) => ({
        id: person.id,
        name: person.name,
        count: null,
        group: index === 0 ? (group.teamName ?? t('filter.noTeam')) : null,
      })),
    ),
  ];

  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={searchId}>{t('filter.search', { count: model.people.length })}</Label>
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
      <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {t('filter.matches', { shown: matching.length, total: model.people.length })}
      </p>
      <OptionList options={options} chosen={model.person} autoFocus={false} onPick={onPick} enterRef={enter} />
    </div>
  );
}

/**
 * The phone's filter sheet: the Smjena choice as radio rows with their
 * counts, the Osoba search list — in *Kalendar* with the note that a person
 * replaces the team — and `Poništi` and a live `Prikaži {n} osoba`. Every
 * choice writes the URL at once, so Back works; the sheet stays open until
 * `Prikaži…`, Escape, its close or a wide viewport.
 *
 * The native Dialog keeps its children mounted while closed, so the content
 * is keyed on `opening`: every opening starts with an empty search and focus
 * on the Smjena choice that reads chosen (`Sve smjene` while none does).
 */
function FilterSheet({
  id,
  opening,
  model,
  open,
  onClose,
  onChange,
}: {
  readonly id: string;
  readonly opening: number;
  readonly model: FilterBarModel;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onChange: (change: FilterChange) => void;
}): ReactNode {
  const titleId = useId();
  const chosen = useRef<HTMLButtonElement>(null);
  const everyTeam = useRef<HTMLButtonElement>(null);

  // After the Dialog's own effect has shown it (a child's effect runs first).
  useEffect(() => {
    if (!open) return;
    (chosen.current ?? everyTeam.current)?.focus();
  }, [open, opening]);

  return (
    <SheetDialog id={id} titleId={titleId} open={open} onClose={onClose}>
      <SheetContent
        key={opening}
        titleId={titleId}
        model={model}
        chosen={chosen}
        everyTeam={everyTeam}
        onClose={onClose}
        onChange={onChange}
      />
    </SheetDialog>
  );
}

/** The phone's bottom sheet: the native `Dialog`, docked to the bottom edge. */
export function SheetDialog({
  id,
  titleId,
  open,
  onClose,
  children,
}: {
  readonly id: string;
  readonly titleId: string;
  readonly open: boolean;
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
      className="mb-0 mt-auto w-full max-w-none rounded-b-none rounded-t-2xl border-x-0 border-b-0 pb-[env(safe-area-inset-bottom,0px)]"
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

/** The sheet's content, mounted afresh for every opening. */
function SheetContent({
  titleId,
  model,
  chosen,
  everyTeam,
  onClose,
  onChange,
}: {
  readonly titleId: string;
  readonly model: FilterBarModel;
  readonly chosen: RefObject<HTMLButtonElement | null>;
  readonly everyTeam: RefObject<HTMLButtonElement | null>;
  readonly onClose: () => void;
  readonly onChange: (change: FilterChange) => void;
}): ReactNode {
  const teamId = useId();
  const personId = useId();
  const value = teamOptionOf(model);

  return (
    <>
      <SheetHeader titleId={titleId} onClose={onClose} />
      <section aria-labelledby={teamId} className="grid min-w-0 gap-2">
        <h3 id={teamId} className="font-sans text-sm font-semibold">
          {t('filter.team')}
        </h3>
        <RadioGroup
          aria-labelledby={teamId}
          className="gap-1"
          value={value}
          onValueChange={(next) => {
            onChange(teamOptionChoiceOf(model, next));
          }}
        >
          <RadioRow ref={value === ALL_TEAMS_OPTION ? chosen : everyTeam} value={ALL_TEAMS_OPTION}>
            {t('filter.allTeams', { count: model.teams.length })}
          </RadioRow>
          {model.teams.map((team) => (
            <RadioRow key={team.id} ref={value === team.id ? chosen : undefined} value={team.id}>
              <span className="flex min-w-0 justify-between gap-3">
                <span className="min-w-0 break-words">{team.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {t('filter.personCount', { count: team.count })}
                </span>
              </span>
            </RadioRow>
          ))}
        </RadioGroup>
      </section>
      <section aria-labelledby={personId} className="grid min-w-0 gap-2">
        <h3 id={personId} className="font-sans text-sm font-semibold">
          {t('filter.person')}
        </h3>
        {model.combine ? null : <p className="text-sm text-muted-foreground">{t('filter.replaceNote')}</p>}
        <PersonOptions
          model={model}
          onPick={(id) => {
            onChange(filterChoiceOf(model, FILTER_PERSON, id));
          }}
        />
      </section>
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
