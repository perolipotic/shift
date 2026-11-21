import type { ReactNode } from 'react';

import { ArrowRight } from '@/components/ui/icon';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { LentFrom } from '@/utils/loan-mark';

/**
 * STORY 18.5 — THE LOAN MARK (UX-DR59, NFR-25): a glyph AND words, never
 * colour alone. The glyph is the existing `ArrowRight` icon, drawn as the
 * calendar's modifier icons are (`size-3`, hidden from assistive technology);
 * the words carry the meaning (`posuđen iz {tim}`, `trenutno u timu {tim}`),
 * already translated by the caller. The text takes the surrounding colour,
 * so no new colour token is drawn anywhere.
 */
export function LoanMark({ children, className }: { readonly children: string; readonly className?: string }): ReactNode {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1 break-words', className)}>
      <ArrowRight aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

/** A lent member's mark in words: `posuđen iz {tim}`, or `posuđen, bez svog tima` with no team of their own. */
export function lentFromText(lentFrom: LentFrom): string {
  return lentFrom.teamName === null ? t('loans.mark.lentFromNone') : t('loans.mark.lentFrom', { team: lentFrom.teamName });
}

/**
 * Under a lent member's team or line, `trenutno u timu {tim}` with the loan
 * glyph — the team they are WITH today, while the row keeps their own
 * (*Ljudi*, a team's roster). Nothing for a member not on loan today.
 * Preceded by a visually hidden separator, so a screen reader announces the
 * line and the mark as two things.
 */
export function LoanTeamNote({ team }: { readonly team: string | null }): ReactNode {
  if (team === null) return null;

  return (
    <span className="block text-xs text-muted-foreground">
      <span className="sr-only">{t('ljudi.status.separator')}</span>
      <LoanMark>{t('loans.mark.now', { team })}</LoanMark>
    </span>
  );
}
