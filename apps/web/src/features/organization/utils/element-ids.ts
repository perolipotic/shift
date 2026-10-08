/**
 * The settings page's element ids (story 7.18), named once so a `htmlFor`, an
 * `aria-labelledby` and a focus target can never spell one differently.
 */

/**
 * The three fact cards' headings, which name their regions and take focus
 * when a dialog's opener is gone.
 */
export const ORGANIZATION_PROFILE_HEADING_ID = 'organization-profile-heading';
export const ORGANIZATION_TIME_HEADING_ID = 'organization-time-heading';
export const ORGANIZATION_FIRE_RANKS_HEADING_ID = 'organization-fire-ranks-heading';

/** The card each dialog closes back onto, by its heading. */
export const ORGANIZATION_DIALOG_CARD_HEADING_IDS = {
  name: ORGANIZATION_PROFILE_HEADING_ID,
  logo: ORGANIZATION_PROFILE_HEADING_ID,
  accent: ORGANIZATION_PROFILE_HEADING_ID,
  leaveYear: ORGANIZATION_TIME_HEADING_ID,
  fireRanks: ORGANIZATION_FIRE_RANKS_HEADING_ID,
} as const;

/**
 * A dialog's Spremi, where focus goes back after a refusal that names no
 * field: the button was disabled while the write was in flight, which drops
 * focus out of it. ONE id for all five, for the refusal's reason below.
 */
export const ORGANIZATION_DIALOG_SAVE_ID = 'organization-dialog-save';

/**
 * A dialog's refusal. ONE id for all five: a dialog draws its body only while
 * it is open, and only one is open at a time.
 */
export const ORGANIZATION_DIALOG_ERROR_ID = 'organization-dialog-error';

/** The fields, each in its own dialog. */
export const ORGANIZATION_NAME_FIELD_ID = 'organization-name';
export const ORGANIZATION_LEAVE_DAY_FIELD_ID = 'organization-leave-day';
export const ORGANIZATION_LEAVE_MONTH_FIELD_ID = 'organization-leave-month';
export const ORGANIZATION_LOGO_FIELD_ID = 'organization-logo';

/** The accent's radio group: its label, and the UX-DR5 rule that describes it. */
export const ORGANIZATION_ACCENT_LABEL_ID = 'organization-accent-label';
export const ORGANIZATION_ACCENT_RULE_ID = 'organization-accent-rule';

/** The fire-rank setting's radio group label, and the line that says what switching it off keeps. */
export const ORGANIZATION_FIRE_RANKS_LABEL_ID = 'organization-fire-ranks-label';
export const ORGANIZATION_FIRE_RANKS_HINT_ID = 'organization-fire-ranks-hint';

/**
 * What each radio group is described by while its dialog shows a refusal:
 * its own line AND the refusal, as an ID reference list, so the group
 * points at the alert the way the name and leave-year fields do.
 */
export const ORGANIZATION_ACCENT_REFUSED_DESCRIPTION = `${ORGANIZATION_ACCENT_RULE_ID} ${ORGANIZATION_DIALOG_ERROR_ID}`;
export const ORGANIZATION_FIRE_RANKS_REFUSED_DESCRIPTION = `${ORGANIZATION_FIRE_RANKS_HINT_ID} ${ORGANIZATION_DIALOG_ERROR_ID}`;

/** Each dialog's title, which names the dialog; all five are mounted at once. */
export const ORGANIZATION_DIALOG_HEADING_IDS = {
  name: 'organization-name-dialog-heading',
  logo: 'organization-logo-dialog-heading',
  accent: 'organization-accent-dialog-heading',
  leaveYear: 'organization-leave-year-dialog-heading',
  fireRanks: 'organization-fire-ranks-dialog-heading',
} as const;
