import * as React from "react"

import { useDismiss } from "@/hooks/dismiss"
import { cn } from "@/lib/utils"

// The one NON-MODAL anchored surface (story 7.4), beside the modal `Dialog`:
// drawn below its nearest positioned ancestor, left-aligned to it, and never
// wider than the viewport less the page gutters, so a phone at 320 px does
// not scroll sideways. `bg-popover` and `sh-lg`, the elevation DESIGN.md
// gives Dialog, Sheet and Popover.
//
// Closed means UNMOUNTED: nothing inside it keeps state between openings.
// Escape and a press outside `region` (the trigger and the surface, so a
// press on the trigger toggles rather than closes and reopens) ask the
// screen to close it through `onClose`; the screen owns where focus goes,
// and closes it, without moving focus, when focus leaves the region.
//
// No copy and no `t()`: the accessible name is the screen's `aria-label`.

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean
  onClose: () => void
  /** Everything a press inside does not close it from: its trigger and itself. */
  region: React.RefObject<HTMLElement | null>
  /** The dialog's name, from the screen's `t()`. */
  "aria-label": string
}

function Popover({ open, onClose, region, className, children, ...props }: PopoverProps) {
  useDismiss(open, region, onClose)

  if (!open) return null

  return (
    <div
      role="dialog"
      className={cn(
        "absolute left-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 text-popover-foreground shadow-sh-lg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { Popover }
