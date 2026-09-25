import * as React from "react"

import { cn } from "@/components/utils"

// A round initials chip (visual refresh B). DECORATIVE: the name it stands for
// is always rendered beside it, so the chip is hidden from assistive technology
// here, once, with the bare boolean `aria-hidden`. Screens never spell the
// attribute. The initials come from `@/components/initials`, which the node
// suite executes.

const Avatar = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    aria-hidden
    className={cn(
      "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-xs font-bold text-secondary-foreground",
      className
    )}
    {...props}
  />
))
Avatar.displayName = "Avatar"

export { Avatar }
