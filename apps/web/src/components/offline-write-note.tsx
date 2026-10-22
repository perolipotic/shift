import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import type { WriteGate } from '@/lib/offline/use-write-gate';

/**
 * The offline write note (story 8.3a, UX-DR45): *Za spremanje je potrebna
 * veza.* — the offline `Notice` that states why a gated write control does
 * nothing. Drawn once per form, dialog footer or card action row, ONLY while
 * offline, under the gate's `noteId`, which every gated control there names
 * in its `aria-describedby`. On sign-in it reads *Za prijavu je potrebna
 * veza.* Nothing online.
 */
export function OfflineWriteNote({
  gate,
  signIn = false,
  className,
}: {
  readonly gate: WriteGate;
  /** The sign-in submit's wording rather than the save's. */
  readonly signIn?: boolean;
  /** Where the note sits in its row or card (story 8.3b), applied only when it is drawn. */
  readonly className?: string;
}) {
  if (gate.online) return null;

  return (
    <Notice id={gate.noteId} role="status" variant="offline" className={className}>
      {signIn ? t('offline.signInNeedsConnection') : t('offline.needsConnection')}
    </Notice>
  );
}
