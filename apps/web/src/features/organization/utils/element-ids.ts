/**
 * The settings page's element ids (story 7.18), named once so a `htmlFor`, an
 * `aria-labelledby` and a focus target can never spell one differently.
 */

/**
 * The fact cards' headings, which name their regions; the three with dialogs
 * take focus when a dialog's opener is gone.
 */
export const ORGANIZATION_PROFILE_HEADING_ID = 'organization-profile-heading';
export const ORGANIZATION_TIME_HEADING_ID = 'organization-time-heading';
export const ORGANIZATION_FIRE_RANKS_HEADING_ID = 'organization-fire-ranks-heading';
/** The email-notifications card (story 10.3). */
export const ORGANIZATION_EMAIL_NOTIFICATIONS_HEADING_ID = 'organization-email-notifications-heading';
/** The minimum-members card (story 11.1). */
export const ORGANIZATION_MINIMUM_MEMBERS_HEADING_ID = 'organization-minimum-members-heading';
/** The *Satni pojasi* facts card (deferred work from 7.18): a summary, and the way to the editor. */
export const ORGANIZATION_HOUR_BANDS_HEADING_ID = 'organization-hour-bands-heading';
/** The *Vrste odsutnosti* card (story 13.1b): the types, and the one dialog that adds or edits one. */
export const ORGANIZATION_ABSENCE_TYPES_HEADING_ID = 'organization-absence-types-heading';

/** The card each dialog closes back onto, by its heading. */
export const ORGANIZATION_DIALOG_CARD_HEADING_IDS = {
  name: ORGANIZATION_PROFILE_HEADING_ID,
  logo: ORGANIZATION_PROFILE_HEADING_ID,
  accent: ORGANIZATION_PROFILE_HEADING_ID,
  leaveYear: ORGANIZATION_TIME_HEADING_ID,
  fireRanks: ORGANIZATION_FIRE_RANKS_HEADING_ID,
  emailNotifications: ORGANIZATION_EMAIL_NOTIFICATIONS_HEADING_ID,
  minimumMembers: ORGANIZATION_MINIMUM_MEMBERS_HEADING_ID,
} as const;

/**
 * A dialog's Spremi, where focus goes back after a refusal that names no
 * field: the button was disabled while the write was in flight, which drops
 * focus out of it. ONE id for all six, for the refusal's reason below.
 */
export const ORGANIZATION_DIALOG_SAVE_ID = 'organization-dialog-save';

/**
 * A dialog's refusal. ONE id for all six: a dialog draws its body only while
 * it is open, and only one is open at a time.
 */
export const ORGANIZATION_DIALOG_ERROR_ID = 'organization-dialog-error';

/**
 * The read's retry, where focus goes when a re-read loses the row under an
 * open dialog: the one control left on the page.
 */
export const ORGANIZATION_READ_RETRY_ID = 'organization-read-retry';

/** The fields, each in its own dialog. */
export const ORGANIZATION_NAME_FIELD_ID = 'organization-name';
export const ORGANIZATION_LEAVE_DAY_FIELD_ID = 'organization-leave-day';
export const ORGANIZATION_LEAVE_MONTH_FIELD_ID = 'organization-leave-month';
export const ORGANIZATION_LOGO_FIELD_ID = 'organization-logo';
/** Minimum members' number field (story 11.1). */
export const ORGANIZATION_MINIMUM_MEMBERS_FIELD_ID = 'organization-minimum-members';
/** The line under it that says what empty means. */
export const ORGANIZATION_MINIMUM_MEMBERS_HINT_ID = 'organization-minimum-members-hint';
/** `Odaberi sliku`, where focus goes after a refused upload: the pick to retry. */
export const ORGANIZATION_LOGO_CHOOSE_ID = 'organization-logo-choose';

/** The accent's radio group: its label, and the UX-DR5 rule that describes it. */
export const ORGANIZATION_ACCENT_LABEL_ID = 'organization-accent-label';
export const ORGANIZATION_ACCENT_RULE_ID = 'organization-accent-rule';

/** The fire-rank setting's radio group label, and the line that says what switching it off keeps. */
export const ORGANIZATION_FIRE_RANKS_LABEL_ID = 'organization-fire-ranks-label';
export const ORGANIZATION_FIRE_RANKS_HINT_ID = 'organization-fire-ranks-hint';

/** The email-notifications switch's radio group label, and the line that says what off means. */
export const ORGANIZATION_EMAIL_NOTIFICATIONS_LABEL_ID = 'organization-email-notifications-label';
export const ORGANIZATION_EMAIL_NOTIFICATIONS_HINT_ID = 'organization-email-notifications-hint';

/**
 * What each radio group is described by while its dialog shows a refusal:
 * its own line AND the refusal, as an ID reference list, so the group
 * points at the alert the way the name and leave-year fields do.
 */
export const ORGANIZATION_ACCENT_REFUSED_DESCRIPTION = `${ORGANIZATION_ACCENT_RULE_ID} ${ORGANIZATION_DIALOG_ERROR_ID}`;
export const ORGANIZATION_FIRE_RANKS_REFUSED_DESCRIPTION = `${ORGANIZATION_FIRE_RANKS_HINT_ID} ${ORGANIZATION_DIALOG_ERROR_ID}`;
export const ORGANIZATION_EMAIL_NOTIFICATIONS_REFUSED_DESCRIPTION = `${ORGANIZATION_EMAIL_NOTIFICATIONS_HINT_ID} ${ORGANIZATION_DIALOG_ERROR_ID}`;
/** Story 11.1: minimum members' field, described by its hint and, after a refusal, the refusal too. */
export const ORGANIZATION_MINIMUM_MEMBERS_REFUSED_DESCRIPTION = `${ORGANIZATION_MINIMUM_MEMBERS_HINT_ID} ${ORGANIZATION_DIALOG_ERROR_ID}`;

/** Each dialog's title, which names the dialog; all six are mounted at once. */
export const ORGANIZATION_DIALOG_HEADING_IDS = {
  name: 'organization-name-dialog-heading',
  logo: 'organization-logo-dialog-heading',
  accent: 'organization-accent-dialog-heading',
  leaveYear: 'organization-leave-year-dialog-heading',
  fireRanks: 'organization-fire-ranks-dialog-heading',
  emailNotifications: 'organization-email-notifications-dialog-heading',
  minimumMembers: 'organization-minimum-members-dialog-heading',
} as const;

/**
 * The absence type dialog (story 13.1b), one for adding and editing: its
 * title, the name field, the drawing choice's label, its first radio (where a
 * refusal about the choice puts focus), the line that says why annual leave's
 * choice is locked, the refusal, and Spremi. Its own ids, not the settings
 * dialogs': it is a dialog of the card's own hook, open beside none of theirs.
 */
export const ORGANIZATION_ABSENCE_TYPE_DIALOG_HEADING_ID = 'organization-absence-type-dialog-heading';
export const ORGANIZATION_ABSENCE_TYPE_NAME_FIELD_ID = 'organization-absence-type-name';
export const ORGANIZATION_ABSENCE_TYPE_DRAWS_LABEL_ID = 'organization-absence-type-draws-label';
export const ORGANIZATION_ABSENCE_TYPE_DRAWS_FIELD_ID = 'organization-absence-type-draws';
export const ORGANIZATION_ABSENCE_TYPE_ANNUAL_HINT_ID = 'organization-absence-type-annual-hint';
/** The edit dialog's line on what changing a non-annual type's flag does (story 13.2b), which describes the choice. */
export const ORGANIZATION_ABSENCE_TYPE_DRAWS_HINT_ID = 'organization-absence-type-draws-hint';
export const ORGANIZATION_ABSENCE_TYPE_ERROR_ID = 'organization-absence-type-error';
export const ORGANIZATION_ABSENCE_TYPE_SAVE_ID = 'organization-absence-type-save';
/** What annual leave's locked choice is described by after a refusal: the hint AND the refusal. */
export const ORGANIZATION_ABSENCE_TYPE_ANNUAL_REFUSED_DESCRIPTION = `${ORGANIZATION_ABSENCE_TYPE_ANNUAL_HINT_ID} ${ORGANIZATION_ABSENCE_TYPE_ERROR_ID}`;
