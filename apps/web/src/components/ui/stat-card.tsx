import * as React from "react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// A summary figure on a card (visual refresh B): a small label above a large
// value in the body face, whose digits are Shift Figures (story 7.2: numbers
// are never Syne, so "17" is not misread as "ı7"). Two slots and no copy. The
// screen passes a `t()` label and a `formatNumber` value, counted by a pure
// module from data the screen already holds.

const StatCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <Card ref={ref} className={cn("flex min-w-0 flex-col gap-2 p-4", className)} {...props} />
))
StatCard.displayName = "StatCard"

const StatLabel = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      "break-words text-xs font-semibold uppercase tracking-wide text-muted-foreground",
      className
    )}
    {...props}
  />
))
StatLabel.displayName = "StatLabel"

const StatValue = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-3xl font-extrabold leading-none tabular-nums", className)}
    {...props}
  />
))
StatValue.displayName = "StatValue"

export { StatCard, StatLabel, StatValue }
