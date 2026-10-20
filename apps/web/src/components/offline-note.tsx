import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { formatDate, formatTime } from '@/lib/i18n/format';

/** When the snapshot drawn offline is from, and the organization's zone to state it in. */
export interface OfflineSnapshot {
  /** The oldest read's `dataUpdatedAt`, in epoch milliseconds. */
  readonly asOf: number;
  readonly timeZone: string;
}

/**
 * The as-of note (story 8.2, UX-DR45): *Bez veze · stanje od 10.10.2026 14:32*,
 * the offline `Notice` under a surface's `PageHeader` while its whole cached
 * snapshot is drawn with no connection — and, just after a reconnect, until
 * every read is fresh again. The time is the OLDEST of the surface's reads,
 * in the organization's zone (`formatDate`/`formatTime`), so nothing on the
 * screen is older than the note says. Nothing on a fresh surface.
 */
export function OfflineNote({ offline }: { readonly offline: OfflineSnapshot | null }) {
  if (offline === null) return null;

  const instant = new Date(offline.asOf);

  return (
    <Notice role="status" variant="offline">
      {t('offline.asOf', { date: formatDate(instant, offline.timeZone), time: formatTime(instant, offline.timeZone) })}
    </Notice>
  );
}
