import { useEffect, type ReactNode } from 'react';

import {
  ActiveChips,
  FilterField,
  FilterSummaryCard,
  SearchableOptions,
  SheetDialog,
  SheetFooter,
  SheetHeader,
  useFilterBarState,
} from '@/components/filter-bar';
import { t } from '@/lib/i18n';
import { focusAfterOptionRemovalOf, optionChipsActiveCount, type OptionChipState } from '@/utils/filter-bar';

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
  /** The sheet's label over the chip's field: `Razina`. */
  readonly heading: string;
  readonly options: readonly OptionChoice[];
  /** The id of the option chosen; one of `options`. */
  readonly chosen: string;
  /** The id of the option that is no filter (`sve`, `svi`): listed in the picker whatever is typed. */
  readonly allId?: string;
}

/**
 * A BAR OF OPTION CHIPS (stories 7.13, 15.7): {@link FilterBar}'s drawing —
 * the summary card with `Filtri` and its count, one removable chip per set
 * filter with `Očisti sve`, and the *Filtri* sheet with one searchable field
 * per chip — over chips that each choose one value from a list. *Ljudi* draws
 * Razina, Smjena and Status with it, *Godišnji*'s overview Smjena and Stanje;
 * *Kalendar* and *Sati* keep {@link FilterBar}.
 *
 * PRESENTATIONAL: the screen decides the chips, the summary, and what each
 * press changes. `onPick` and `onRemove` make the change and return the state
 * it leaves, as one key, and focus waits for `stateKey` to read it before it
 * moves — after a ✕ to the next set chip, else `Filtri`. `onClear` is
 * `Očisti sve` and places focus itself (the screen's search); `onReset` is
 * the sheet's `Poništi`, which leaves focus in the sheet. `showClear` is the
 * screen's: *Ljudi*'s default `Status: aktivni` is a drawn chip that counts in
 * the Badge, with no `Očisti sve`. `describedBy` points `Filtri` and the chips
 * at the screen's refusal while one is shown.
 *
 * `leading` (the search) and `trailing` share the summary card's row.
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
  /** `Očisti sve` is shown. */
  readonly showClear: boolean;
  /** How many rows the filters leave: the sheet's `Prikaži {n} osoba`. */
  readonly shownCount: number;
  /** The state the bar shows, as the key `onPick` and `onRemove` return. */
  readonly stateKey: string;
  readonly disabled?: boolean;
  /** The id of the screen's refusal while one is shown, for `Filtri` and the chips. */
  readonly describedBy?: string | undefined;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onPick: (key: string, id: string) => string;
  readonly onRemove: (key: string) => string;
  readonly onClear: () => void;
  readonly onReset: () => void;
}): ReactNode {
  const bar = useFilterBarState(stateKey);
  const { closeSheet } = bar;

  // Dead while there is no answer to narrow: an open sheet closes.
  useEffect(() => {
    if (disabled) closeSheet();
  }, [disabled, closeSheet]);

  return (
    <div ref={bar.root} tabIndex={-1} className="min-w-0 outline-none">
      <div role="group" aria-label={t('filter.label')} className="grid min-w-0 gap-2">
      <FilterSummaryCard
        summary={summary}
        activeCount={optionChipsActiveCount(chips)}
        expanded={bar.expandedBy(null)}
        sheetId={bar.sheetId}
        filtriRef={bar.filtri}
        disabled={disabled}
        describedBy={describedBy}
        leading={leading}
        trailing={trailing}
        onOpen={() => {
          bar.openSheet(null);
        }}
      />
      <ActiveChips
        chips={chips
          .filter((chip) => chip.active)
          .map((chip) => ({ key: chip.key, text: chip.text, removeLabel: chip.removeLabel }))}
        showClear={showClear}
        expandedBy={bar.expandedBy}
        sheetId={bar.sheetId}
        disabled={disabled}
        describedBy={describedBy}
        chipRef={bar.chipRef}
        onOpen={bar.openSheet}
        onRemove={(key) => {
          bar.focusOnceShown(onRemove(key), focusAfterOptionRemovalOf(chips, key));
        }}
        onClear={onClear}
      />
      </div>
      <SheetDialog id={bar.sheetId} titleId={bar.titleId} open={bar.sheetOpen} onClose={bar.closeSheet} side>
        {bar.sheetOpen ? (
          <>
            <SheetHeader titleId={bar.titleId} onClose={bar.closeSheet} />
            {chips.map((chip) => (
              <FilterField
                key={chip.key}
                label={chip.heading}
                value={chip.options.find((option) => option.id === chip.chosen)?.label ?? chip.chosen}
                pickerLabel={chip.pickerLabel}
                disabled={disabled}
                fieldRef={bar.fieldRef(chip.key)}
                picker={(done) => (
                  <SearchableOptions
                    searchLabel={t('filter.optionSearch', { label: chip.heading })}
                    items={chip.options}
                    nameOf={(option) => option.label}
                    keep={(option) => option.id === chip.allId}
                    rowsOf={(matching) =>
                      matching.map((option) => ({ id: option.id, name: option.label, count: option.count, group: null }))
                    }
                    chosen={chip.chosen}
                    onPick={(id) => {
                      if (id !== null) onPick(chip.key, id);
                      done();
                    }}
                  />
                )}
              />
            ))}
            <SheetFooter shownCount={shownCount} onReset={onReset} onClose={bar.closeSheet} />
          </>
        ) : null}
      </SheetDialog>
    </div>
  );
}
