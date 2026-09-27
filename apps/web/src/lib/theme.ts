import { useEffect, useState } from 'react';

/**
 * The theme preference: follow the operating system, or pin light or dark.
 *
 * UX-DR2 shipped both themes with no toggle; this reverses that (human decision
 * 2026-09-25). `system` stays the default, so a person who never touches the
 * control sees exactly what they saw before.
 *
 * THE DOCUMENT CARRIES THE RESOLVED THEME, never the preference: `data-theme`
 * on `<html>` is always `light` or `dark`, and `index.css` declares the dark
 * tokens once, under `:root[data-theme="dark"]`. Letting CSS resolve `system`
 * itself would need the dark block twice — once in a media query, once under
 * the attribute — and `theme-tokens.test.ts` admits exactly one declaration per
 * token per theme.
 *
 * `index.html` runs the same resolution inline before the first paint, so a
 * pinned dark theme does not flash light while the bundle loads, and it owns
 * following an OS switch while the preference is `system` — on every screen,
 * including sign-in, where this hook is never mounted. The two must agree on
 * STORAGE_KEY and the three values; `theme.test.ts` reads the HTML to hold
 * them together.
 *
 * Per device, in `localStorage`: a preference about a screen, not about a
 * person, so it is not a column. Storage can throw (private windows, blocked
 * site data) and every access falls back to `system`.
 */

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const STORAGE_KEY = 'shift.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isPreference(value: unknown): value is ThemePreference {
  return (THEME_PREFERENCES as readonly unknown[]).includes(value);
}

export function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Unpersisted is still applied: the choice holds until the page reloads.
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/** The press order: system → light → dark → system. */
export function nextPreference(preference: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(preference);
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length] ?? 'system';
}

function applyTheme(preference: ThemePreference): void {
  const systemDark = window.matchMedia(DARK_QUERY).matches;
  document.documentElement.setAttribute('data-theme', resolveTheme(preference, systemDark));
}

/** The current preference and a setter that persists and applies it. */
export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => applyTheme(preference), [preference]);

  function choose(next: ThemePreference): void {
    writePreference(next);
    setPreference(next);
  }

  return [preference, choose];
}
