import { useEffect, type RefObject } from 'react';

/**
 * Closes an open popover on Escape and on a press anywhere outside `region`
 * (the sidebar's profile menu and the month picker, story 7.4). Listens only
 * while `open`, so a closed menu costs nothing.
 *
 * `inPanel` is for a popover inside a modal `Dialog` (the filter sheet's
 * pickers, story 15.7): ONE PRESS, ONE LAYER.
 *
 * - The Escape is heard first, in the capture phase, and cancelled there, so
 *   the browser makes no close request for the dialog and one Escape closes
 *   the popover, never the sheet under it too. An Escape that ends an IME
 *   composition is the composition's own, and is left alone.
 * - A press on the dialog's backdrop closes the popover, and the click it
 *   ends in is stopped before the dialog hears it, so the sheet stays open.
 */
export function useDismiss(
  open: boolean,
  region: RefObject<HTMLElement | null>,
  close: () => void,
  inPanel = false,
): void {
  useEffect(() => {
    if (!open) return;

    function pressOutside(event: PointerEvent): void {
      const target = event.target as Node;

      if (region.current?.contains(target)) return;
      if (inPanel && target instanceof HTMLDialogElement) {
        document.addEventListener(
          'click',
          (click) => {
            if (click.target === target) click.stopPropagation();
          },
          { capture: true, once: true },
        );
      }
      close();
    }
    function escape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (inPanel) {
        if (event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
      }
      close();
    }

    document.addEventListener('pointerdown', pressOutside);
    document.addEventListener('keydown', escape, inPanel);
    return () => {
      document.removeEventListener('pointerdown', pressOutside);
      document.removeEventListener('keydown', escape, inPanel);
    };
  }, [open, region, close, inPanel]);
}
