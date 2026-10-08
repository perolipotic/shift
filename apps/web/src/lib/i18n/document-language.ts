/**
 * Keeps `<html lang>` equal to the active locale (L3).
 *
 * `index.html` ships `lang="hr"` as the pre-script default, which is right for
 * the one locale of the MVP and wrong the moment a second resource file is
 * added. Screen readers pick their pronunciation and browsers their translation
 * offer from this attribute, so it follows i18next at runtime instead of being
 * a literal somebody has to remember to edit — adding a language changes no
 * logic here.
 *
 * Structural types, not i18next's and the DOM's: the node suite (AD-15, no
 * jsdom) executes this with plain objects.
 */

interface LanguageSource {
  language: string;
  on: (event: 'languageChanged', listener: (language: string) => void) => void;
}

interface LanguageTarget {
  documentElement: { lang: string };
}

/** Sets `lang` now and again on every later language change. */
export function bindDocumentLanguage(source: LanguageSource, target: LanguageTarget): void {
  target.documentElement.lang = source.language;
  source.on('languageChanged', (language) => {
    target.documentElement.lang = language;
  });
}
