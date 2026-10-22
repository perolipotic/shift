import { useId } from 'react';

import { appFreshness } from '@/lib/offline/app-freshness';
import { useFreshnessClock } from '@/lib/offline/use-snapshot-freshness';

/** One id a control's `aria-describedby` may name, or nothing. */
export type DescribedById = string | null | undefined | false;

/**
 * THE WRITE GATE (story 8.3a, UX-DR29/UX-DR45): whether a write control may
 * write now, and the wiring that says why it may not.
 *
 * Offline, a gated control stays FOCUSABLE — `aria-disabled`, never
 * `disabled`, the erasure dialog's convention — names the offline write note
 * in its `aria-describedby`, and its `onClick`/`onSubmit` returns early. So a
 * press sends nothing, queues nothing and starts no erasure check, and the
 * reason is read where the focus is. Reconnecting only lifts the gate:
 * nothing is sent until the member presses again.
 */
export interface WriteGate {
  /** Writes may be sent: the page's freshness clock is online. */
  readonly online: boolean;
  /** The id of this site's `OfflineWriteNote`, which a gated control names offline. */
  readonly noteId: string;
  /** The control's `aria-disabled`: `true` offline, nothing online. */
  readonly disabled: true | undefined;
  /** The control's `aria-describedby`: its own ids, and the note's added offline. */
  readonly describedBy: (...ids: readonly DescribedById[]) => string | undefined;
}

/** The gate for `online` (pure, so the node suite executes it, AD-15). */
export function writeGateOf(online: boolean, noteId = 'offline-write-note'): WriteGate {
  return {
    online,
    noteId,
    disabled: online ? undefined : true,
    describedBy: (...ids) => {
      const named = [...ids, online ? null : noteId].filter((id): id is string => typeof id === 'string' && id !== '');

      return named.length === 0 ? undefined : named.join(' ');
    },
  };
}

/**
 * The write gate of one site — a form, a dialog footer or a card's action
 * row — with its own note id, re-rendering when the connection drops or
 * returns (`useFreshnessClock`).
 */
export function useWriteGate(): WriteGate {
  const { online } = useFreshnessClock();
  const noteId = useId();

  return writeGateOf(online, `offline-write-${noteId}`);
}

/**
 * Whether writes may be sent NOW, outside React: the same freshness clock the
 * gate reads (`appFreshness`, over TanStack's `onlineManager`). The write
 * functions in the gated hooks guard on it (defence in depth: a handler that
 * slipped past the component's own guard still sends nothing offline), and so
 * does Odjava's local fallback — one online source for both.
 */
export function writesOnline(): boolean {
  return appFreshness.current().online;
}
