/**
 * The settings page's eight dialogs (story 7.18), one per change: the name,
 * the logo and the accent on *Profil*, the leave year's start on *Vrijeme i
 * godina*, the carry-over setting on its own card (story 13.4), the fire-rank
 * setting on its own card, the email-notifications switch on its own (story
 * 10.3), and minimum members on its own (story 11.1). Identifiers, never copy:
 * each names which dialog is open and which card a landed save is said on.
 */
export const NAME_DIALOG = 'name';
export const LOGO_DIALOG = 'logo';
export const ACCENT_DIALOG = 'accent';
export const LEAVE_YEAR_DIALOG = 'leaveYear';
export const FIRE_RANKS_DIALOG = 'fireRanks';
export const EMAIL_NOTIFICATIONS_DIALOG = 'emailNotifications';
/** Minimum members (story 11.1), on its own card. */
export const MINIMUM_MEMBERS_DIALOG = 'minimumMembers';
/** The carry-over setting (story 13.4), on its own card after *Vrijeme i godina*. */
export const CARRY_OVER_DIALOG = 'carryOver';

export const ORGANIZATION_DIALOGS = [
  NAME_DIALOG,
  LOGO_DIALOG,
  ACCENT_DIALOG,
  LEAVE_YEAR_DIALOG,
  FIRE_RANKS_DIALOG,
  EMAIL_NOTIFICATIONS_DIALOG,
  MINIMUM_MEMBERS_DIALOG,
  CARRY_OVER_DIALOG,
] as const;

export type OrganizationDialog = (typeof ORGANIZATION_DIALOGS)[number];

/** The dialogs *Profil* opens, so its card says a save that landed in any of them. */
export const PROFILE_DIALOGS: readonly OrganizationDialog[] = [NAME_DIALOG, LOGO_DIALOG, ACCENT_DIALOG];
