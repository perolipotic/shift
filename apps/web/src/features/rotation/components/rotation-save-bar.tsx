import { Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { RotationBuilder } from '@/features/rotation/hooks/use-rotation-builder';
import { saveBarHintOf } from '@/features/rotation/services/history';
import type { RotationDraft } from '@/features/rotation/utils/draft';
import { ROTATION_SAVE_BAR_ID } from '@/features/rotation/utils/element-ids';
import { saveBarClassOf } from '@/features/rotation/utils/stepper';
import { t } from '@/lib/i18n';

/**
 * THE SAVE BAR (story 5.5c, mockup `setup-1.html` §2): the builder's last
 * element — at the end of the builder, after the history — full width
 * across the page's `p-6`, on the card's background behind a top border.
 * From `sm` up (where the phone's tab bar is gone) it is `sticky` at the
 * viewport's bottom while there are unsaved changes, so the save stays in
 * reach however far the admin scrolled, and the page's scroll padding
 * clears it (`index.css`, keyed on `data-sticky`) so a focused control is
 * never under it; below `sm` it is never sticky — it stays in flow at the
 * end, after the step actions and the history, and never stacks on the
 * tab bar. The hint wraps above the buttons on a phone, and is a polite
 * live region, so becoming unsaved is announced. Only rendered with a
 * draft, like the step actions and the history.
 */
export function RotationSaveBar({
  builder,
  current,
}: {
  readonly builder: RotationBuilder;
  readonly current: RotationDraft;
}) {
  const { snapshot, today, unsaved, pending, discard, saveButton, requestSave } = builder;
  const hint =
    snapshot === null || today === null ? null : saveBarHintOf(unsaved, snapshot, today, current.effectiveFrom);

  return (
    <div
      id={ROTATION_SAVE_BAR_ID}
      role="region"
      aria-label={t('rotation.builder.saveBar.label')}
      data-sticky={unsaved}
      className={saveBarClassOf(unsaved)}
    >
      {/* ALWAYS MOUNTED, so the live region exists before its text arrives;
          empty, it takes no space. */}
      <p
        aria-live="polite"
        className="min-w-0 basis-full text-sm text-muted-foreground empty:sr-only sm:flex-1 sm:basis-auto"
      >
        {hint === null
          ? null
          : hint.inForceLabel === null
            ? t('rotation.builder.saveBar.hint', { effectiveFrom: hint.effectiveLabel })
            : t('rotation.builder.saveBar.hintInForce', {
                effectiveFrom: hint.effectiveLabel,
                inForceFrom: hint.inForceLabel,
              })}
      </p>
      <div className="flex flex-wrap gap-3 sm:ml-auto">
        {/* An outline, never the alarm variant: it drops only a local draft. */}
        {unsaved ? (
          <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={discard}>
            {t('rotation.builder.saveBar.discard')}
          </Button>
        ) : null}
        {/* THE ONE SAVE, moved here from the header (story 5.5c), every rule kept. */}
        <Button
          ref={saveButton}
          className="h-11"
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            void requestSave();
          }}
        >
          <Save aria-hidden />
          {t('rotation.builder.save')}
        </Button>
      </div>
    </div>
  );
}
