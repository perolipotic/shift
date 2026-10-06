import hr from '../../apps/web/src/lib/i18n/locales/hr.json' with { type: 'json' };

/**
 * The application's own resource file. Every locator name comes from here, so a
 * reworded label changes the test with it instead of silently breaking it.
 */
export { hr };

/** Fills `{name}`-style placeholders by plain substitution. An ICU
 *  `{count, plural, …}` message is not handled here: use {@link plural}. */
export function fill(message: string, values: Readonly<Record<string, string>>): string {
  return message.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder);
}

/** The destinations only an admin reaches (`features/navigation/utils/destinations.ts`). */
export const ADMIN_DESTINATIONS = [
  hr.nav.raspored,
  hr.nav.ljudi,
  hr.nav.postavkeRotacije,
  hr.nav.organizacija,
] as const;

/** The ones every role reaches. */
export const MEMBER_DESTINATIONS = [hr.nav.danas, hr.nav.kalendar, hr.nav.sati, hr.nav.godisnji] as const;

/** Escapes every character a `RegExp` gives meaning to, so `text` matches only itself. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The month toolbar's trigger (story 7.4), `Listopad 2026, odaberi mjesec…`,
 * whatever the month: *Kalendar* and *Sati* share it.
 */
export const MONTH_TRIGGER_NAME = new RegExp(
  `^${escapeRegExp(hr.kalendar.chooseMonth).replace(/\\\{\w+\\\}/g, '.+')}`,
);

/** The plural categories and exact selectors (`=0`, `=1`, …) ICU allows. */
const PLURAL_SELECTOR = /^(?:=\d+|zero|one|two|few|many|other)$/;

/**
 * An ICU `{count, plural, …}` message filled for `count` the way the app's
 * i18next-icu fills it: an exact selector (`=N`) first, then the category
 * Croatian picks (`Intl.PluralRules('hr')`), then `other`; every `#` in the
 * chosen form becomes `count` formatted by `Intl.NumberFormat('hr')`
 * (`1.234`). The block may be the whole message or part of it.
 *
 * Only that shape is supported, and anything else THROWS rather than being
 * guessed at: a second argument (`{team}`), a non-`count` or non-`plural`
 * argument, an `offset:`, or a form holding braces of its own.
 */
export function plural(message: string, count: number): string {
  const open = message.indexOf('{');
  const close = message.lastIndexOf('}');
  if (open === -1 || close < open) throw new Error(`E2E: ${message} has no plural block`);

  const head = /^\{count, plural,\s*/.exec(message.slice(open));
  if (head === null) throw new Error(`E2E: ${message} is not a {count, plural, …} message`);
  // Every brace lies between `open` and `close`, so a second argument before
  // or after the block leaves braces in the body, which the parse refuses.

  const body = message.slice(open + head[0].length, close);
  const forms = new Map<string, string>();
  const form = /\s*([^\s{}]+)\s*\{([^{}]*)\}/y;
  let at = 0;
  while (at < body.trimEnd().length) {
    form.lastIndex = at;
    const match = form.exec(body);
    const selector = match?.[1];
    if (match === null || selector === undefined || !PLURAL_SELECTOR.test(selector)) {
      throw new Error(`E2E: ${message} holds ICU this helper does not support (offset, nesting or a bad selector)`);
    }
    forms.set(selector, match[2] ?? '');
    at = form.lastIndex;
  }

  const chosen =
    forms.get(`=${String(count)}`) ?? forms.get(new Intl.PluralRules('hr').select(count)) ?? forms.get('other');
  if (chosen === undefined) throw new Error(`E2E: ${message} has no form for ${String(count)} and no other`);

  const shown = new Intl.NumberFormat('hr').format(count);

  return message.slice(0, open) + chosen.replaceAll('#', shown) + message.slice(close + 1);
}
