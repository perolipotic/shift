/**
 * The organization's email-notifications switch (story 10.3, `0044`): its two
 * radio values and the words for each. On is the default; off, the outbox
 * takes no email row for any member of the organization.
 */

/** The switch's two radio values. Strings because a radio group speaks them. */
export const EMAIL_NOTIFICATIONS_ON = 'on';
export const EMAIL_NOTIFICATIONS_OFF = 'off';

/** The options the dialog offers, on first: the default. */
export const EMAIL_NOTIFICATIONS_OPTIONS: readonly boolean[] = [true, false];

export function emailNotificationsValue(on: boolean): string {
  return on ? EMAIL_NOTIFICATIONS_ON : EMAIL_NOTIFICATIONS_OFF;
}

/**
 * What the radio group hands back, given what the row holds. A value that is
 * neither option keeps the stored setting, the direction that changes nothing.
 */
export function emailNotificationsOf(value: string, stored: boolean): boolean {
  if (value === EMAIL_NOTIFICATIONS_ON) return true;
  if (value === EMAIL_NOTIFICATIONS_OFF) return false;

  return stored;
}

/** The option label, and the fact the settings page states. */
export function emailNotificationsMessageKey(
  on: boolean,
): 'organization.emailNotificationsOff' | 'organization.emailNotificationsOn' {
  return on ? 'organization.emailNotificationsOn' : 'organization.emailNotificationsOff';
}

/** The status line a landed save leaves on the card, as a sentence naming the setting. */
export function emailNotificationsStatusMessageKey(
  on: boolean,
): 'organization.emailNotificationsStatusOff' | 'organization.emailNotificationsStatusOn' {
  return on ? 'organization.emailNotificationsStatusOn' : 'organization.emailNotificationsStatusOff';
}
