import * as React from "react"

import { useDismiss } from "@/hooks/dismiss"
import { cn } from "@/lib/utils"

// The one NON-MODAL anchored surface (story 7.4), beside the modal `Dialog`:
// drawn below its nearest positioned ancestor, left-aligned to it, and never
// wider than the viewport less the page gutters, so a phone at 320 px does
// not scroll sideways. A `glass-panel` since story 15.2, the layered glass it
// shares with Dialog and the docked sheets (the reading alpha, blurred, with
// the opaque and forced-colours fallbacks in `index.css`).
//
// NEVER INSIDE A `glass-*` ANCESTOR: a blurred ancestor is a backdrop root,
// and the panel would blur only that ancestor rather than the page behind it.
// The profile menu in the glass sidebar is therefore its own opaque surface,
// not this primitive.
//
// Closed means UNMOUNTED: nothing inside it keeps state between openings.
// Escape and a press outside `region` (the trigger and the surface, so a
// press on the trigger toggles rather than closes and reopens) ask the
// screen to close it through `onClose`; the screen owns where focus goes,
// and closes it, without moving focus, when focus leaves the region.
//
// `opaque` IS THE POPOVER INSIDE A PANEL (story 15.7, the filter sheet's
// pickers): the sheet is a glass panel, so a glass popover there would blur
// only the panel. It is drawn on the opaque `--popover` with its own border and
// shadow, and names no glass utility. Inside the sheet's modal `<dialog>` an
// Escape would also cancel the dialog, so the opaque popover hears Escape
// first and cancels it: one Escape closes one layer.
//
// No copy and no `t()`: the accessible name is the screen's `aria-label`.

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean
  onClose: () => void
  /** Everything a press inside does not close it from: its trigger and itself. */
  region: React.RefObject<HTMLElement | null>
  /** The dialog's name, from the screen's `t()`. */
  "aria-label": string
  /** Inside a panel (a Dialog): opaque, and its Escape never reaches the panel. */
  opaque?: boolean
}

function Popover({ open, onClose, region, opaque = false, className, children, ...props }: PopoverProps) {
  useDismiss(open, region, onClose, opaque)

  if (!open) return null

  return (
    <div
      role="dialog"
      className={cn(
        opaque
          ? "absolute left-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-sh-lg"
          : "glass-panel absolute left-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)] rounded-lg p-3 text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { Popover }
