import { t } from '@/lib/i18n';
import { accentMessageKey, brandAccentOf } from '@/features/organization/utils/accent';

/**
 * What the row holds, named the way the accent control names it — the status
 * line beside the settings screen's accent `<select>` (story 1.4c).
 *
 * THE SAME ANSWER THE SELECTED OPTION GIVES, including for an accent this
 * build does not know: `accentMessageKey` folds an unrecognised key to
 * `Neutralna` — which is right for the class it resolves, and would be a lie
 * here, where the whole job is to say what the DATABASE holds. So an
 * unrenderable accent reads as its stored value, exactly as its option does.
 * Data, never a key: this build has no name for it.
 *
 * ITS OWN MODULE rather than a line in `accent.ts`, because that module is
 * shared with the chrome and the lockup and imports nothing; this one needs
 * `t()`.
 */
export function storedAccentLabel(accent: string | null): string {
  return brandAccentOf(accent) === null && accent !== null
    ? accent
    : t(accentMessageKey(accent));
}
