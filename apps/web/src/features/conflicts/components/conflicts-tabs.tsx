import type { KeyboardEvent, ReactNode } from 'react';

import {
  CONFLICTS_PANEL_ID,
  CONFLICTS_TABS,
  TAB_UNRESOLVED,
  conflictsTabId,
  tabAfterKey,
  type ConflictsTab,
} from '@/features/conflicts/services/resolved-conflicts';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * *Raspored*'s two tabs (story 7.16; UX-DR20, UX-DR25): *Neriješeni*, the
 * default, which carries its count at zero too once the queue is read, and
 * *Riješeni*. A tablist with one tab stop: the arrow keys, Home and End move
 * and select.
 */
export function ConflictsTabs({
  tab,
  unresolvedCount,
  onTab,
}: {
  readonly tab: ConflictsTab;
  /** The queue's count, or `null` while it is not read: no count is guessed. */
  readonly unresolvedCount: number | null;
  readonly onTab: (tab: ConflictsTab) => void;
}): ReactNode {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const next = tabAfterKey(tab, event.key);

    if (next === null) return;

    event.preventDefault();
    onTab(next);
    document.getElementById(conflictsTabId(next))?.focus();
  }

  return (
    <div role="tablist" aria-label={t('raspored.tabs.label')} className="flex min-w-0 gap-1 rounded-md bg-muted p-1">
      {CONFLICTS_TABS.map((one) => {
        const selected = one === tab;
        const label =
          one === TAB_UNRESOLVED && unresolvedCount !== null
            ? t('raspored.tabs.unresolvedCount', { count: unresolvedCount })
            : one === TAB_UNRESOLVED
              ? t('raspored.tabs.unresolved')
              : t('raspored.tabs.resolved');

        return (
          <button
            key={one}
            id={conflictsTabId(one)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={CONFLICTS_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onTab(one)}
            onKeyDown={onKeyDown}
            className={cn(
              'min-h-11 flex-1 rounded-sm px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'bg-card text-foreground underline underline-offset-4 shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
