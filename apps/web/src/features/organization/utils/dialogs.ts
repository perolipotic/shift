/**
 * The settings page's six dialogs (story 7.18), one per change: the name,
 * the logo and the accent on *Profil*, the leave year's start on *Vrijeme i
 * godina*, the fire-rank setting on its own card, and the email-notifications
 * switch on its own (story 10.3). Identifiers, never copy:
 * each names which dialog is open and which card a landed save is said on.
 */
export const NAME_DIALOG = 'name';
export const LOGO_DIALOG = 'logo';
export const ACCENT_DIALOG = 'accent';
export const LEAVE_YEAR_DIALOG = 'leaveYear';
export const FIRE_RANKS_DIALOG = 'fireRanks';
export const EMAIL_NOTIFICATIONS_DIALOG = 'emailNotifications';

export const ORGANIZATION_DIALOGS = [
  NAME_DIALOG,
  LOGO_DIALOG,
  ACCENT_DIALOG,
  LEAVE_YEAR_DIALOG,
  FIRE_RANKS_DIALOG,
  EMAIL_NOTIFICATIONS_DIALOG,
] as const;

export type OrganizationDialog = (typeof ORGANIZATION_DIALOGS)[number];

/** The dialogs *Profil* opens, so its card says a save that landed in any of them. */
export const PROFILE_DIALOGS: readonly OrganizationDialog[] = [NAME_DIALOG, LOGO_DIALOG, ACCENT_DIALOG];
