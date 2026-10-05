import type { ErasureDialogCopy } from '@/features/conflicts/components/erasure-dialog';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import { t } from '@/lib/i18n';

/**
 * Every word the member page's erasure dialogs show (story 5.5e), in the
 * `ljudi.erasures.*` keys: the one place the team card and the status card
 * turn a list of erasures into the shared dialog's copy. `save` is the
 * card's own confirm, as its confirmation words it.
 *
 * ALWAYS "TAJ DAN BEZ": a team move or a status change never changes whether
 * a team works that day — the shift type is the rotation's and its
 * overrides' — so the row names the team the conflict was on, still working,
 * without the member.
 */
export function memberErasureCopyOf(rows: readonly ErasureRow[], save: string): ErasureDialogCopy {
  const partsOf = (row: ErasureRow) => ({
    team: row.teamName,
    weekday: row.weekday,
    date: row.dayMonth,
    type: row.shiftTypeName,
  });

  return {
    title: t('ljudi.erasures.title', { count: rows.length }),
    lede: t('ljudi.erasures.lede', { count: rows.length }),
    changed: t('ljudi.erasures.changed'),
    rowTitle: (row) => t('ljudi.erasures.rowTitle', partsOf(row)),
    rowDetail: (row) => t('ljudi.erasures.rowWithout', { member: row.memberName, team: row.teamName }),
    decision: (row) => t('ljudi.erasures.decision', partsOf(row)),
    confirm: t('ljudi.erasures.confirm'),
    keep: t('ljudi.erasures.keep'),
    back: t('ljudi.erasures.back'),
    kept: t('ljudi.erasures.kept'),
    save,
  };
}
