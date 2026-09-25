import * as React from "react"

import { cn } from "@/components/utils"

// A section's number beside its card title (story 2.3b, owner layout): a small
// round badge in the primary tint the icon tile and badge measure, holding one
// figure. DECORATIVE: the heading beside it says what the section is, and the
// order is the document's own, so it is hidden from assistive technology. It
// renders its `value` and nothing else — no copy and no `t()`.

export interface SectionNumberProps extends React.HTMLAttributes<HTMLSpanElement> {
  readonly value: number
}

function SectionNumber({ className, value, ...props }: SectionNumberProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-heading text-sm font-bold tabular-nums text-foreground",
        className
      )}
      {...props}
    >
      {value}
    </span>
  )
}

export { SectionNumber }
