import { useEffect, type RefObject } from 'react';

/**
 * Closes an open popover on Escape and on a press anywhere outside `region`
 * (the sidebar's profile menu). Listens only while `open`, so a closed menu
 * costs nothing.
 */
export function useDismiss(
  open: boolean,
  region: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    function pressOutside(event: PointerEvent): void {
      if (!region.current?.contains(event.target as Node)) close();
    }
    function escape(event: KeyboardEvent): void {
      if (event.key === 'Escape') close();
    }

    document.addEventListener('pointerdown', pressOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', pressOutside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, region, close]);
}
