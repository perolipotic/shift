import { describe, expect, it } from 'vitest';

import { i18n, initLocalization } from '@/lib/i18n';
import { bindDocumentLanguage } from '@/lib/i18n/document-language';

/** A document with only what the binding touches, and an i18next stand-in. */
function fakes(language: string) {
  const listeners: ((language: string) => void)[] = [];
  const target = { documentElement: { lang: 'hr' } };
  const source = {
    language,
    on: (_event: 'languageChanged', listener: (language: string) => void) => {
      listeners.push(listener);
    },
  };

  return { target, source, emit: (next: string) => listeners.forEach((listener) => listener(next)) };
}

describe('bindDocumentLanguage', () => {
  it('writes the active language at once, replacing the build-time default', () => {
    const { target, source } = fakes('en');

    bindDocumentLanguage(source, target);

    expect(target.documentElement.lang).toBe('en');
  });

  it('follows every later language change', () => {
    const { target, source, emit } = fakes('hr');

    bindDocumentLanguage(source, target);
    emit('de');

    expect(target.documentElement.lang).toBe('de');
  });

  it('is wired into initLocalization, so the real instance drives the document', async () => {
    const document = { documentElement: { lang: '' } };

    Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
    try {
      await initLocalization();
      expect(document.documentElement.lang).toBe(i18n.language);
      expect(document.documentElement.lang).toBe('hr');
    } finally {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });
});
