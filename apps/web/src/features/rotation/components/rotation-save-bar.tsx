
import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { FloppyDisk } from '@/components/ui/icon';
import type { RotationBuilder } from '@/features/rotation/hooks/use-rotation-builder';
import { saveBarHintOf } from '@/features/rotation/services/history';
import type { RotationDraft } from '@/features/rotation/utils/draft';
import { ROTATION_SAVE_BAR_ID } from '@/features/rotation/utils/element-ids';
import { saveBarClassOf } from '@/features/rotation/utils/stepper';
import { t } from '@/lib/i18n';
import type { WriteGate } from '@/lib/offline/use-write-gate';

/**
 * THE SAVE BAR (story 5.5c, mockup `setup-1.html` §2; glass since story
 * 15.4): the builder's last element — a floating `glass-over-content` pill,
 * `rounded-3xl`, inside the page's `p-6` (`saveBarClassOf`). From `sm` up
 * (where the phone's tab bar is gone) it is `sticky` 16 px above the
 * viewport's bottom while there are unsaved changes, so the save stays in
 * reach however far the admin scrolled, and the page's scroll padding
 * clears it (`index.css`, keyed on `data-sticky`) so a focused control is
 * never under it; below `sm` it is never sticky — it stays in flow at the
 * end, after the step actions, and never stacks on the tab bar. Content
 * scrolls under the glass, so its text is `foreground`, never muted, and
 * *Odbaci promjene* is the borderless `chrome` Button: an `outline`
 * border measures under 3:1 there over an ink button. The hint wraps above the buttons on a phone, and is a polite
 * live region, so becoming unsaved is announced. Only rendered with a
 * draft, like the step actions and the history.
 */
export function RotationSaveBar({
  builder,
  current,
  gate,
}: {
  readonly builder: RotationBuilder;
  readonly current: RotationDraft;
  /**
   * The save's write gate (story 8.3b), shared with the unchecked save's
   * retry in `RotationNotices`, so the page draws one note for both, here.
   */
  readonly gate: WriteGate;
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
        className="min-w-0 basis-full text-sm text-foreground empty:sr-only sm:flex-1 sm:basis-auto"
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
      {/* STORY 8.3b: offline, the save is gated before its erasure check
          starts, and the note says why — a row of its own in the bar's
          wrapping flex. */}
      <OfflineWriteNote gate={gate} className="min-w-0 basis-full" />
      <div className="flex flex-wrap gap-3 sm:ml-auto">
        {/* The glass `chrome` variant, never the alarm one: it drops only a
            local draft, and an outline's border fails 3:1 on this glass. */}
        {unsaved ? (
          <Button className="h-11" type="button" variant="chrome" disabled={pending} onClick={discard}>
            {t('rotation.builder.saveBar.discard')}
          </Button>
        ) : null}
        {/* THE ONE SAVE, moved here from the header (story 5.5c), every rule kept. */}
        <Button
          ref={saveButton}
          className="h-11 aria-disabled:opacity-50"
          type="button"
          disabled={pending}
          aria-disabled={gate.disabled}
          aria-describedby={gate.describedBy()}
          aria-busy={pending}
          onClick={() => {
            if (!gate.online) return;
            void requestSave();
          }}
        >
          <FloppyDisk aria-hidden />
          {t('rotation.builder.save')}
        </Button>
      </div>
    </div>
  );
}
