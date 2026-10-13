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
/** *Vrijedi od*'s hint, which describes the date; with the refusal beside it once there is one. */
export const MEMBER_STATUS_DATE_HINT_ID = 'member-status-date-hint';
export const MEMBER_STATUS_DATE_HINT_AND_ERROR = `${MEMBER_STATUS_DATE_HINT_ID} ${MEMBER_STATUS_ERROR_ID}`;
/** The status dialog's one neutral question. */
export const MEMBER_STATUS_PROMPT_ID = 'member-status-prompt';
/** The withdrawal confirmation's question. */
export const MEMBER_STATUS_WITHDRAW_PROMPT_ID = 'member-status-withdraw-prompt';

/** *Prijava*: the card's heading, and the reset's refusal, which describes its button. */
export const MEMBER_SIGN_IN_HEADING_ID = 'member-sign-in-heading';
export const MEMBER_RESET_ERROR_ID = 'member-reset-error';
/** The issued password's dialog title, where focus lands once a reset lands (E915, story 7.8). */
export const MEMBER_RESET_DIALOG_HEADING_ID = 'member-reset-dialog-heading';

/** *Dodaj osobu*'s dialog: its title, and its refusal. */
export const MEMBER_ADD_DIALOG_HEADING_ID = 'member-add-dialog-heading';
export const MEMBER_ADD_ERROR_ID = 'member-form-error';
/** The second step's `Račun je izrađen: …` line, where focus lands once the form is replaced. */
export const MEMBER_ADD_CREATED_ID = 'member-add-created';
/** The username's hint, which describes the field; with the refusal beside it once there is one. */
export const MEMBER_ADD_USERNAME_HINT_ID = 'member-username-hint';
export const MEMBER_ADD_USERNAME_HINT_AND_ERROR = `${MEMBER_ADD_USERNAME_HINT_ID} ${MEMBER_ADD_ERROR_ID}`;
