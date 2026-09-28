/**
 * The calendar screen's element ids that one element carries and another
 * names (`aria-labelledby`), written ONCE so the two sides cannot drift
 * apart. The month heading's id is `MONTH_HEADING_ID` in
 * `@/features/calendar/utils/grid-keys`, where focus falls back to it, and
 * the day detail's own id is `DAY_DETAIL_DIALOG_ID` in
 * `@/features/calendar/utils/day-detail`.
 */

/** The legend's heading, which names its list of marks. */
export const LEGEND_HEADING_ID = 'kalendar-legend';

/** The chosen person's name (story 3.3b), which names their day list before the month. */
export const PERSON_HEADING_ID = 'kalendar-person-heading';

/** The day detail's title (story 3.4b), which names the Dialog. */
export const DAY_DETAIL_HEADING_ID = 'kalendar-detail-heading';

/** The heading over the day detail's roster, which names the roster list. */
export const DAY_DETAIL_ROSTER_ID = 'kalendar-detail-roster';

/** The override block's heading (story 3.5a), which names its section. */
export const DAY_DETAIL_OVERRIDE_ID = 'kalendar-detail-override';

/** The pending-review block's heading (story 3.5c), which names its section. */
export const DAY_DETAIL_PENDING_ID = 'kalendar-detail-pending';

/** The override form's heading (story 3.5b), which names the form. */
export const OVERRIDE_SET_HEADING_ID = 'kalendar-override-set-heading';

/** The override form's type `Select`, which its label names. */
export const OVERRIDE_TYPE_FIELD_ID = 'kalendar-override-type';

/** The override form's reason `Input`, which its label names. */
export const OVERRIDE_REASON_FIELD_ID = 'kalendar-override-reason';

/** The override form's refusal, which the refused field is described by. */
export const OVERRIDE_SET_ERROR_ID = 'kalendar-override-set-error';

/** The removal confirmation's prompt, which names its Dialog. */
export const OVERRIDE_REMOVE_PROMPT_ID = 'kalendar-override-remove-prompt';

/** The removal confirmation's refusal. */
export const OVERRIDE_REMOVE_ERROR_ID = 'kalendar-override-remove-error';
