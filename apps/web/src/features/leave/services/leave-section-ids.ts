/**
 * The leave card's DOM ids and its two non-copy strings (story 5.1c onward):
 * what a field, a region or a line is named or described by. Split out of
 * `leave-section.ts` (epic 13 retro A8), which re-exports its public names;
 * it imports nothing from there.
 */

/** The half group's label id, which names the radio group (story 13.5). */
export const LEAVE_HALF_LABEL_ID = 'member-leave-half-label';

/** *Pola dana*'s id, which its label points at (story 13.5). */
export const LEAVE_HALF_SWITCH_ID = 'member-leave-half-day';

/** *Pola dana*'s hint's id, which describes the switch (story 13.5). */
export const LEAVE_HALF_HINT_ID = 'member-leave-half-day-hint';

/**
 * What *Pola dana* is described by (story 13.5): its hint, and the reason a
 * half day is refused while that refusal marks the switch — no half card
 * is drawn then, so the switch carries it. The admin dialog's ids by
 * default; the member's request form passes its own (story 13.5b).
 */
export function leaveHalfSwitchDescribedByOf(
  marked: boolean,
  hintId: string = LEAVE_HALF_HINT_ID,
  reasonId: string = LEAVE_REASON_ID,
): string {
  return marked ? `${hintId} ${reasonId}` : hintId;
}

/** The type group's label id, which names the radio group (story 13.2b). */
export const LEAVE_TYPE_LABEL_ID = 'member-leave-type-label';

/** An empty date field: nothing entered yet, or cleared after a landed save. */
export const LEAVE_NO_DATE = '';

/** The refusal's id, which the od field is described by while it stands. */
export const LEAVE_ERROR_ID = 'member-leave-error';

/** The card's heading id, which names its region. */
export const LEAVE_HEADING_ID = 'member-leave-heading';

/** The records list's heading id, which names its section (story 5.2b). */
export const LEAVE_RECORDS_HEADING_ID = 'member-leave-records-heading';

/** The removal prompt's id, which names its confirmation (story 5.2b). */
export const LEAVE_REMOVE_PROMPT_ID = 'member-leave-remove-prompt';

/**
 * The whitespace each replacement line follows inside a notice's paragraph
 * (story 5.4e): the lines are drawn as blocks, and this keeps a screen reader
 * from running "…uklonjen.Dino…" together. Not copy, so not a key.
 */
export const LEAVE_LINE_SEPARATOR = ' ';

/** The preview's polite live region's id (story 5.4e: the amend's replacement lines are announced there). */
export const LEAVE_PREVIEW_ID = 'member-leave-preview';

/** The replacement lines' id, which describes the removal confirmation while it shows any (story 5.4e). */
export const LEAVE_REMOVE_REPLACEMENTS_ID = 'member-leave-remove-replacements';

/** The removal confirmation's line of the conflicts it clears (story 7.12), which describes it. */
export const LEAVE_REMOVE_CLEARS_ID = 'member-leave-remove-clears';

/** The leave dialog's title (story 7.12), which names the dialog. */
export const LEAVE_DIALOG_HEADING_ID = 'member-leave-dialog-heading';

/** The reason's id, which the field it names is described by while that field is marked. */
export const LEAVE_REASON_ID = 'member-leave-reason';
