import * as React from "react"

import { cn } from "@/components/utils"

// A summary figure INSIDE a card (design refresh C), where `StatCard` would be
// a card inside a card: a muted panel with an icon tile, a small label and a
// heading-face value. Two slots and no copy, like `StatCard`.

const StatTile = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex min-w-0 items-center gap-3 rounded-md bg-muted p-4", className)}
    {...props}
  />
))
StatTile.displayName = "StatTile"

const StatTileLabel = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
))
StatTileLabel.displayName = "StatTileLabel"

const StatTileValue = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("font-heading text-xl font-bold leading-tight tabular-nums", className)}
    {...props}
  />
))
StatTileValue.displayName = "StatTileValue"

export { StatTile, StatTileLabel, StatTileValue }
