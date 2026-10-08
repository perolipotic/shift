/**
 * The member page's new element ids (story 7.11), named once so the cards
 * that draw them and the hook that returns focus to them never drift apart:
 * the page's title, each card's heading, and each dialog's title. A card's
 * heading is where focus lands when its dialog closes and its opener is gone.
 */

/** The page's `h1`: the person's name. */
export const MEMBER_PAGE_HEADING_ID = 'member-page-heading';

/** *Osnovni podaci*: the card's heading, its dialog's title, and the member write's refusal. */
export const MEMBER_BASICS_HEADING_ID = 'member-basics-heading';
export const MEMBER_BASICS_DIALOG_HEADING_ID = 'member-basics-dialog-heading';
export const MEMBER_FORM_ERROR_ID = 'member-form-error';

/** *Smjena*. */
export const MEMBER_TEAM_HEADING_ID = 'member-team-heading';
export const MEMBER_TEAM_DIALOG_HEADING_ID = 'member-team-dialog-heading';
export const MEMBER_TEAM_ERROR_ID = 'member-team-error';

/** *Pravo*, on the leave card: its dialog's title and its one field. */
export const MEMBER_ALLOWANCE_DIALOG_HEADING_ID = 'member-allowance-dialog-heading';
export const MEMBER_ALLOWANCE_FIELD_ID = 'member-leave';

/** *Status*. */
export const MEMBER_STATUS_HEADING_ID = 'member-status-heading';
export const MEMBER_STATUS_DIALOG_HEADING_ID = 'member-status-dialog-heading';
export const MEMBER_STATUS_ERROR_ID = 'member-status-error';
/** The status dialog's one neutral question. */
export const MEMBER_STATUS_PROMPT_ID = 'member-status-prompt';
/** The withdrawal confirmation's question. */
export const MEMBER_STATUS_WITHDRAW_PROMPT_ID = 'member-status-withdraw-prompt';

/** *Prijava*: the card's heading, and the reset's refusal, which describes its button. */
export const MEMBER_SIGN_IN_HEADING_ID = 'member-sign-in-heading';
export const MEMBER_RESET_ERROR_ID = 'member-reset-error';
