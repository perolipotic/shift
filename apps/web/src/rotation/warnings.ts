import {
  COVERAGE_GAP,
  DUPLICATE_COVERAGE,
  REST_GAP,
  rotationWarningsOf,
  type RotationWarning,
} from '@shift/domain';

import { formatIsoDate } from '@/i18n/format';
import { draftAssignmentOf, draftStepsOf, normalizedDraftOf, type RotationDraft } from '@/rotation/draft';
import { rotationTeamsOf, type RotationSnapshot } from '@/rotation/list';
import type { RotationSaveOutcome } from '@/rotation/write';
import { durationValuesOf, shiftTypeDurationMessageKey } from '@/shift-types/list';

/**
 * What saving a rotation will actually do, in words (story 2.5, CAP-10,
 * FR-25, FR-26, UX-DR23).
 *
 * THE WARNINGS ARE THE DOMAIN'S (AD-7). This module hands `rotationWarningsOf`
 * the rotation that was just saved — the draft's synthetic steps and one
 * assignment per active team, exactly as the preview projects them — and maps
 * each code it returns to a key and its values: type names by id, dates
 * through `formatIsoDate`, the duration through the shift types' duration
 * keys, and every count as an ICU plural. It is the only place those keys are
 * chosen. Nothing here projects, walks a cycle or takes a modulo.
 *
 * THEY NEVER BLOCK. They are computed only after a save has landed, from the
 * draft that was saved and on the date the save used; a refused save has
 * none, and a throw while computing them is logged and leaves the plain
 * confirmation.
 */

/** Logged when the warnings of a landed save could not be computed. */
export const ROTATION_WARNINGS_FAILED = 'ROTATION_WARNINGS_FAILED';

// ------------------------------------------------------------ the messages

/** The line a warning renders as. Exhaustive over the codes and their cases. */
export function rotationWarningMessageKey(
  warning: RotationWarning,
):
  | 'rotation.builder.warnings.coverageGap'
  | 'rotation.builder.warnings.duplicateCoverage'
  | 'rotation.builder.warnings.restGap'
  | 'rotation.builder.warnings.restGapUnknown'
  | 'rotation.builder.warnings.restGapEndless'
  | 'rotation.builder.warnings.restGapEndlessUnknown' {
  switch (warning.code) {
    case COVERAGE_GAP:
      return 'rotation.builder.warnings.coverageGap';
    case DUPLICATE_COVERAGE:
      return 'rotation.builder.warnings.duplicateCoverage';
    case REST_GAP:
      if (warning.endless) {
        return warning.minutes === null
          ? 'rotation.builder.warnings.restGapEndlessUnknown'
          : 'rotation.builder.warnings.restGapEndless';
      }
      return warning.minutes === null
        ? 'rotation.builder.warnings.restGapUnknown'
        : 'rotation.builder.warnings.restGap';
    default: {
      const unhandled: never = warning;

      return unhandled;
    }
  }
}

/** The line above the warnings, counting them. */
export function warningsSummaryMessageKey(): 'rotation.builder.warnings.summary' {
  return 'rotation.builder.warnings.summary';
}

/** One date of a coverage warning, with the types it concerns. */
export function warningDateMessageKey(): 'rotation.builder.warnings.date' {
  return 'rotation.builder.warnings.date';
}

/** Types of one date are listed; the types of a run are chained in the order worked. */
export const WARNING_LIST = 'list';
export const WARNING_CHAIN = 'chain';

export type WarningJoin = typeof WARNING_LIST | typeof WARNING_CHAIN;

/** What joins the items of a list of names. */
export function warningSeparatorMessageKey(
  join: WarningJoin,
): 'rotation.builder.warnings.listSeparator' | 'rotation.builder.warnings.typeSeparator' {
  return join === WARNING_CHAIN
    ? 'rotation.builder.warnings.typeSeparator'
    : 'rotation.builder.warnings.listSeparator';
}

/** Every key a warning's text may resolve through. */
export type WarningTextKey =
  | ReturnType<typeof rotationWarningMessageKey>
  | ReturnType<typeof warningsSummaryMessageKey>
  | ReturnType<typeof warningDateMessageKey>
  | ReturnType<typeof warningSeparatorMessageKey>
  | ReturnType<typeof shiftTypeDurationMessageKey>;

/** Names joined by a separator key when the text is resolved. */
export interface WarningList {
  readonly join: WarningJoin;
  readonly items: readonly string[];
}

/** A key and its values; a value may be a list of names or a nested text (a duration). */
export interface WarningText {
  readonly key: WarningTextKey;
  readonly values: Readonly<Record<string, string | number | WarningList | WarningText>>;
}

/** One warning: its line, and for a coverage warning one detail per date. */
export interface RotationWarningLine {
  readonly text: WarningText;
  readonly details: readonly WarningText[];
}

/** The translator, `t` at the edge; typed to the keys a warning can use. */
export type WarningTranslate = (key: WarningTextKey, values: Readonly<Record<string, string | number>>) => string;

function isList(value: WarningList | WarningText): value is WarningList {
  return 'items' in value;
}

/** A warning text resolved through `translate`, lists joined and nested texts resolved first. */
export function warningTextOf(text: WarningText, translate: WarningTranslate): string {
  const values: Record<string, string | number> = {};

  for (const [name, value] of Object.entries(text.values)) {
    if (typeof value === 'string' || typeof value === 'number') {
      values[name] = value;
    } else if (isList(value)) {
      values[name] = value.items.join(translate(warningSeparatorMessageKey(value.join), {}));
    } else {
      values[name] = warningTextOf(value, translate);
    }
  }

  return translate(text.key, values);
}

/** The line above the warnings: how many there are. */
export function warningsSummaryOf(lines: readonly RotationWarningLine[]): WarningText {
  return { key: warningsSummaryMessageKey(), values: { count: lines.length } };
}

// ------------------------------------------------------------ the mapping

/**
 * The warnings of saving `entered` on `savedOn`, as lines to render: the
 * draft as `saveRotation` sends it (normalized to the active teams), each
 * team on its step at the draft's anchor.
 *
 * @throws RangeError on any precondition of `rotationWarningsOf`.
 */
export function rotationWarningLinesOf(
  snapshot: RotationSnapshot,
  entered: RotationDraft,
  savedOn: string,
): readonly RotationWarningLine[] {
  const teams = rotationTeamsOf(snapshot);
  const draft = normalizedDraftOf(entered, teams);
  const warnings = rotationWarningsOf({
    steps: draftStepsOf(draft),
    assignments: teams.map((team) => draftAssignmentOf(draft, team.id)),
    shiftTypes: snapshot.types,
    versions: snapshot.types.flatMap((type) => type.versions),
    date: savedOn,
  });
  const nameOf = new Map(snapshot.types.map((type) => [type.id, type.name]));
  const namesOf = (ids: readonly string[], join: WarningJoin): WarningList => ({
    join,
    items: ids.map((id) => nameOf.get(id) ?? id),
  });

  return warnings.map((warning): RotationWarningLine => {
    const key = rotationWarningMessageKey(warning);

    if (warning.code === REST_GAP) {
      const types = namesOf(warning.shiftTypeIds, WARNING_CHAIN);

      return {
        text:
          warning.minutes === null
            ? { key, values: { types } }
            : {
                key,
                values: {
                  types,
                  duration: {
                    key: shiftTypeDurationMessageKey(warning.minutes),
                    values: durationValuesOf(warning.minutes),
                  },
                },
              },
        details: [],
      };
    }

    return {
      text: { key, values: { count: warning.dates.length } },
      details: warning.dates.map((one) => ({
        key: warningDateMessageKey(),
        values: { date: formatIsoDate(one.date) ?? one.date, types: namesOf(one.shiftTypeIds, WARNING_LIST) },
      })),
    };
  });
}

/** A save outcome as the builder shows it: a landed save carries its warnings. */
export type ShownSaveOutcome =
  | Exclude<RotationSaveOutcome, { readonly ok: true }>
  | { readonly ok: true; readonly warnings: readonly RotationWarningLine[] };

/**
 * `saved` as the builder shows it. Only a landed save gets warnings — from the
 * draft that was saved, on the date the save used; a throw computing them is
 * logged and leaves the plain confirmation. A refused save is passed through.
 */
export function shownSaveOutcomeOf(
  saved: RotationSaveOutcome,
  snapshot: RotationSnapshot,
  draft: RotationDraft,
  savedOn: string,
): ShownSaveOutcome {
  if (!saved.ok) return saved;

  try {
    return { ok: true, warnings: rotationWarningLinesOf(snapshot, draft, savedOn) };
  } catch (cause) {
    console.error(ROTATION_WARNINGS_FAILED, cause);

    return { ok: true, warnings: [] };
  }
}
