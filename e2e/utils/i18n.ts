import hr from '../../apps/web/src/i18n/locales/hr.json' with { type: 'json' };

/**
 * The application's own resource file. Every locator name comes from here, so a
 * reworded label changes the test with it instead of silently breaking it.
 */
export { hr };

/** Fills `{name}`-style placeholders. Plural (ICU) messages are not used as
 *  locator names, so a plain substitution is all that is needed. */
export function fill(message: string, values: Readonly<Record<string, string>>): string {
  return message.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder);
}

/** The destinations only an admin reaches (`navigation/destinations.ts`). */
export const ADMIN_DESTINATIONS = [
  hr.nav.raspored,
  hr.nav.ljudi,
  hr.nav.postavkeRotacije,
  hr.nav.organizacija,
] as const;

/** The ones every role reaches. */
export const MEMBER_DESTINATIONS = [hr.nav.danas, hr.nav.kalendar, hr.nav.sati, hr.nav.godisnji] as const;
