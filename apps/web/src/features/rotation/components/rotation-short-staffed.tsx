import type { ReactNode } from 'react';

import type { RotationBuilder } from '@/features/rotation/hooks/use-rotation-builder';
import { ShortStaffedBlock } from '@/features/staffing/components/short-staffed-block';
import { shortStaffedShownOf } from '@/features/staffing/services/short-staffed';
import { t } from '@/lib/i18n';

/**
 * THE BUILDER'S *ŠTO SE MIJENJA* (story 11.2): the builder has none of its
 * own, so the short-staffed block — what saving the draft would newly leave
 * short of people, over the erasure check's own "after" — sits above the save
 * bar under that heading. ALWAYS MOUNTED, a polite live region, so a block
 * that arrives with an edit is announced; empty, it takes no space. Never a
 * gate: the save bar beside it is unchanged.
 */
export function RotationShortStaffed({ builder }: { readonly builder: RotationBuilder }): ReactNode {
  const { shortStaffed } = builder;

  return (
    <div aria-live="polite" className="grid min-w-0 gap-2 empty:hidden">
      {shortStaffedShownOf(shortStaffed) ? (
        <>
          {/* A SECOND-LEVEL HEADING, as each of the builder's cards' titles is under the page's `h1`. */}
          <h2 className="text-sm font-semibold">{t('rotation.builder.changes')}</h2>
          <ShortStaffedBlock report={shortStaffed} />
        </>
      ) : null}
    </div>
  );
}
