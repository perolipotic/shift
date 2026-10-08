import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';

import {
  ChipFrame,
  OptionList,
  SheetDialog,
  SheetFooter,
  SheetHeader,
  SummaryLine,
  drawn,
} from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { useCloseWhenWide, usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import {
  focusAfterOptionRemovalOf,
  optionChipsActiveCount,
  optionPickerAlignOf,
  type OptionChipState,
} from '@/utils/filter-bar';

/** One value an option chip offers: its id, its label, and the count beside it, if any. */
export interface OptionChoice {
  readonly id: string;
  readonly label: string;
  readonly count: string | null;
}

/** One option chip, ready to draw: its words, its options and the one chosen. */
export interface OptionChipView extends OptionChipState {
  /** `Razina: sve`. */
  readonly text: string;
  /** The ✕'s name: `Ukloni filtar razina: Administrator`. */
  readonly removeLabel: string;
  /** The picker's name: `Odaberi razinu`. */
  readonly pickerLabel: string;
  /** The sheet's heading over the chip's radio group: `Razina`. */
  readonly heading: string;
  readonly options: readonly OptionChoice[];
  /** The id of the option chosen; one of `options`. */
  readonly chosen: string;
}

/**
 * A BAR OF OPTION CHIPS (story 7.13): the 7.5 drawing — each chip
 * `Ključ: vrijednost ▾` with its ✕ while set, the option-list picker from
 * 640 px, and below it `Filtri · N` and a bottom sheet with one radio group
 * per chip — over chips that each choose one value from a list. *Ljudi*
 * draws Razina, Smjena and Status with it; *Kalendar* and *Sati* keep
 * {@link FilterBar}.
 *
 * PRESENTATIONAL: the screen decides the chips, the summary, and what each
 * press changes. `onPick` and `onRemove` make the change and return the state
 * it leaves, as one key, and focus waits for `stateKey` to read it before it
 * moves — to the chip, or after a ✕ to the next one, `Filtri` where that is
 * not drawn. `onClear` is `Poništi filtre` and places focus itself; `onReset`
 * is the sheet's `Poništi`, which leaves focus in the sheet. `describedBy`
 * points the chips at the screen's refusal while one is shown.
 *
 * `leading` is drawn before the chips (the search) and `trailing` after
 * them, in the same row.
 */
export function OptionFilterBar({
  chips,
  summary,
  showClear,
  shownCount,
  stateKey,
  disabled = false,
  describedBy,
  leading,
  trailing,
  onPick,
  onRemove,
  onClear,
  onReset,
}: {
  readonly chips: readonly OptionChipView[];
  /** The summary line's text. */
  readonly summary: string;
  /** `Poništi filtre` is shown. */
  readonly showClear: boolean;
  /** How many rows the filters leave: the sheet's `Prikaži {n} osoba`. */
  readonly shownCount: number;
  /** The state the bar shows, as the key `onPick` and `onRemove` return. */
  readonly stateKey: string;
  readonly disabled?: boolean;
  /** The id of the screen's refusal while one is shown, for the chips. */
  readonly describedBy?: string | undefined;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onPick: (key: string, id: string) => string;
  readonly onRemove: (key: string) => string;
  readonly onClear: () => void;
  readonly onReset: () => void;
}): ReactNode {
  const isPhone = usePhone();
  const [open, setOpen] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  const sheetId = useId();
  const chipButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const filtri = useRef<HTMLButtonElement>(null);
  const pending = useRef<{ readonly key: string | null; readonly state: string } | null>(null);
  const sheetTitleId = useId();
  const sheetFirst = useRef<HTMLButtonElement>(null);
  const activeCount = optionChipsActiveCount(chips);

  // After the Dialog's own effect has shown it (a child's effect runs first):
  // the first group's chosen value takes focus.
  useEffect(() => {
    if (sheetOpen) sheetFirst.current?.focus();
  }, [sheetOpen, opening]);

  const focusChip = useCallback((key: string | null) => {
    (drawn(key === null ? null : chipButtons.current.get(key)) ?? drawn(filtri.current))?.focus();
  }, []);

  /** Focus `key`'s chip once the state the change left is drawn. */
  function focusOnceShown(after: string, key: string | null): void {
    if (after === stateKey) {
      focusChip(key);

      return;
    }
    pending.current = { key, state: after };
  }

  useEffect(() => {
    const waiting = pending.current;

    if (waiting === null || waiting.state !== stateKey) return;
    pending.current = null;
    focusChip(waiting.key);
  }, [stateKey, focusChip]);

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

  function closePicker(key: string): void {
    setOpen(null);
    focusChip(key);
  }

  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {leading}
        <div role="group" aria-label={t('filter.label')} className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            ref={filtri}
            type="button"
            variant="outline"
            className="h-11 sm:hidden"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-controls={sheetOpen ? sheetId : undefined}
            disabled={disabled}
            onClick={openSheet}
          >
            {activeCount === 0 ? t('filter.open') : t('filter.openCount', { count: activeCount })}
          </Button>
          {chips.map((chip) => (
            <ChipFrame
              key={chip.key}
              text={chip.text}
              active={chip.active}
              removeLabel={chip.removeLabel}
              pickerLabel={chip.pickerLabel}
              pickerAlign={optionPickerAlignOf(chips, chip.key)}
              open={open === chip.key}
              expanded={isPhone ? sheetOpen : open === chip.key}
              controls={isPhone ? (sheetOpen ? sheetId : null) : null}
              disabled={disabled}
              describedBy={describedBy}
              chipRef={(element) => {
                chipButtons.current.set(chip.key, element);
              }}
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
              onRemove={() => {
                setOpen(null);
                focusOnceShown(onRemove(chip.key), focusAfterOptionRemovalOf(chips, chip.key));
              }}
            >
              <OptionList
                options={chip.options.map((option) => ({
                  id: option.id,
                  name: option.label,
                  count: option.count,
                  group: null,
                }))}
                chosen={chip.chosen}
                autoFocus
                onPick={(id) => {
                  setOpen(null);
                  if (id !== null) focusOnceShown(onPick(chip.key, id), chip.key);
                }}
              />
            </ChipFrame>
          ))}
        </div>
        {trailing}
      </div>
      <SummaryLine
        text={summary}
        showClear={showClear}
        onClear={() => {
          setOpen(null);
          onClear();
        }}
      />
      <SheetDialog id={sheetId} titleId={sheetTitleId} open={sheetOpen} onClose={closeSheet}>
        <OptionSheetContent
          key={opening}
          first={sheetFirst}
          titleId={sheetTitleId}
          chips={chips}
          shownCount={shownCount}
          onClose={closeSheet}
          onPick={onPick}
          onReset={onReset}
        />
      </SheetDialog>
    </div>
  );
}

/**
 * The option sheet's content, mounted afresh for every opening: one radio
 * group per chip, each under its heading; `first` is the first group's
 * chosen value, which the bar focuses once the sheet shows.
 */
function OptionSheetContent({
  first,
  titleId,
  chips,
  shownCount,
  onClose,
  onPick,
  onReset,
}: {
  readonly first: RefObject<HTMLButtonElement | null>;
  readonly titleId: string;
  readonly chips: readonly OptionChipView[];
  readonly shownCount: number;
  readonly onClose: () => void;
  readonly onPick: (key: string, id: string) => string;
  readonly onReset: () => void;
}): ReactNode {
  return (
    <>
      <SheetHeader titleId={titleId} onClose={onClose} />
      {chips.map((chip, index) => (
        <OptionSheetGroup
          key={chip.key}
          chip={chip}
          first={index === 0 ? first : null}
          onPick={(id) => {
            onPick(chip.key, id);
          }}
        />
      ))}
      <SheetFooter shownCount={shownCount} onReset={onReset} onClose={onClose} />
    </>
  );
}

/** One chip's radio group in the option sheet, under its heading. */
function OptionSheetGroup({
  chip,
  first,
  onPick,
}: {
  readonly chip: OptionChipView;
  /** Set to the chosen value's row: the first group's, which the bar focuses. */
  readonly first: RefObject<HTMLButtonElement | null> | null;
  readonly onPick: (id: string) => void;
}): ReactNode {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-2">
      <h3 id={headingId} className="font-sans text-sm font-semibold">
        {chip.heading}
      </h3>
      <RadioGroup aria-labelledby={headingId} className="gap-1" value={chip.chosen} onValueChange={onPick}>
        {chip.options.map((option) => (
          <RadioRow
            key={option.id}
            ref={first !== null && option.id === chip.chosen ? first : undefined}
            value={option.id}
          >
            <span className="flex min-w-0 justify-between gap-3">
              <span className="min-w-0 break-words">{option.label}</span>
              {option.count === null ? null : (
                <span className="shrink-0 text-muted-foreground tabular-nums">{option.count}</span>
              )}
            </span>
          </RadioRow>
        ))}
      </RadioGroup>
    </section>
  );
}
