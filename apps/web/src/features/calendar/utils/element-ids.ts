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

/** The roster changes block's heading (story 3.6a), which names its list. */
export const DAY_DETAIL_ROSTER_CHANGES_ID = 'kalendar-detail-roster-changes';

/** The pending roster changes block's heading (story 3.6a), which names its list. */
export const DAY_DETAIL_ROSTER_PENDING_ID = 'kalendar-detail-roster-pending';

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

/** The inert roster changes block's heading (story 3.6b), which names its list. */
export const DAY_DETAIL_ROSTER_INERT_ID = 'kalendar-detail-roster-inert';

/** The roster form's heading (story 3.6b), which names the form. */
export const ROSTER_SET_HEADING_ID = 'kalendar-roster-set-heading';

/** The roster form's "Skida se" `Select`, which its label names. */
export const ROSTER_OUT_FIELD_ID = 'kalendar-roster-out';

/** The roster form's "Dolazi" `Select`, which its label names. */
export const ROSTER_IN_FIELD_ID = 'kalendar-roster-in';

/** The roster form's reason `Input`, which its label names. */
export const ROSTER_REASON_FIELD_ID = 'kalendar-roster-reason';

/** The roster form's overlap hint (Epic 4 retro C2), which the "Dolazi" `Select` is described by. */
export const ROSTER_OVERLAP_ID = 'kalendar-roster-overlap';

/** The roster form's refusal, which the refused field is described by. */
export const ROSTER_SET_ERROR_ID = 'kalendar-roster-set-error';

/** The roster removal confirmation's prompt, which names its Dialog. */
export const ROSTER_REMOVE_PROMPT_ID = 'kalendar-roster-remove-prompt';

/** The roster removal's refusal. */
export const ROSTER_REMOVE_ERROR_ID = 'kalendar-roster-remove-error';

/** One roster change's line in the day detail (story 3.6b), which its removal is described by. */
export function rosterChangeLineIdOf(overrideId: string): string {
  return `kalendar-roster-change-${overrideId}`;
}

/**
 * An `aria-describedby` of the ids given that are not `null`, space-separated;
 * `undefined` for none, so the attribute is left off.
 */
export function describedByOf(...ids: readonly (string | null)[]): string | undefined {
  const named = ids.filter((id): id is string => id !== null);

  return named.length === 0 ? undefined : named.join(' ');
}
