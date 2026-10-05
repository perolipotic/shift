/**
 * The rotation builder's element ids that one element carries and another
 * names (`aria-labelledby`, `htmlFor`, `aria-describedby`), written ONCE so
 * the two sides cannot drift apart — the calendar's
 * `@/features/calendar/utils/element-ids` convention (story 3.5c).
 */

/** `Izmjene za pregled`'s heading, which names its list. */
export const OVERRIDE_REVIEW_HEADING_ID = 'rotation-overrides-heading';

/** The amend dialog's title, which names the Dialog. */
export const OVERRIDE_AMEND_TITLE_ID = 'rotation-overrides-amend-title';

/** The amend's type `Select`, which its label names. */
export const OVERRIDE_AMEND_TYPE_ID = 'rotation-overrides-amend-type';

/** The amend's reason `Input`, which its label names. */
export const OVERRIDE_AMEND_REASON_ID = 'rotation-overrides-amend-reason';

/** The amend's refusal, which the refused field is described by. */
export const OVERRIDE_AMEND_ERROR_ID = 'rotation-overrides-amend-error';

/** The discard confirmation's prompt, which names its Dialog. */
export const OVERRIDE_DISCARD_PROMPT_ID = 'rotation-overrides-discard-prompt';

/** The discard confirmation's refusal. */
export const OVERRIDE_DISCARD_ERROR_ID = 'rotation-overrides-discard-error';

/** The review's erasure confirmation (story 5.5h): the prefix of its title, lede and kept hint ids. */
export const OVERRIDE_REVIEW_ERASURES_ID = 'rotation-overrides-erasures';

/** The refusal when what a confirm or an amend would erase cannot be checked (story 5.5h). */
export const OVERRIDE_REVIEW_UNCHECKED_ID = 'rotation-overrides-unchecked';

/**
 * The save bar (story 5.5c), which `index.css` finds while it is sticky
 * (`data-sticky="true"`) to pad the page's scroll by its height, so a
 * focused control is never left under it.
 */
export const ROTATION_SAVE_BAR_ID = 'rotation-save-bar';
