import type { ReactNode } from 'react';

import { LoanMark } from '@/components/loan-mark';
import { loanNoticeMessageKey, type LoanNotice } from '@/features/calendar/utils/loan-marks';
import { t } from '@/lib/i18n';

/**
 * STORY 18.5 (UX-DR59): the member's own loan, on *Moj raspored* and *Danas* —
 * `U timu {tim} do {datum}.`, or `Od {od}. u timu {tim} do {do}.` for one
 * ahead — with the loan glyph. The team and dates only: never the reason or
 * the author (FR-92).
 */
export function LoanNoticeLine({ notice, className }: { readonly notice: LoanNotice; readonly className?: string }): ReactNode {
  return (
    <p className={className}>
      <LoanMark>{t(loanNoticeMessageKey(notice.kind), { team: notice.teamName, from: notice.from, to: notice.to })}</LoanMark>
    </p>
  );
}
