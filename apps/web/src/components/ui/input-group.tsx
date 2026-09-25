import * as React from "react"

import { cn } from "@/components/utils"

// A field with a leading icon (design refresh C). The group makes room for the
// icon on whichever `Input` or `Select` it wraps, so neither primitive
// changes: the padding is the group's. `Select` wraps its `<select>` to place
// its chevron, so the select is reached as a descendant, not a child, and that
// positioned wrapper would paint over the icon without its `z-10`. The icon is
// decorative; the field keeps its `<Label>`.

const InputGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative min-w-0 [&>input]:pl-10 [&_select]:pl-10", className)}
    {...props}
  />
))
InputGroup.displayName = "InputGroup"

const InputGroupIcon = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    aria-hidden
    className={cn(
      "pointer-events-none absolute left-3 top-1/2 z-10 flex -translate-y-1/2 text-muted-foreground [&_svg]:size-4",
      className
    )}
    {...props}
  />
))
InputGroupIcon.displayName = "InputGroupIcon"

export { InputGroup, InputGroupIcon }
