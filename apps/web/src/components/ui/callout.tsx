import * as React from "react"

import { cn } from "@/components/utils"

// An explanation box (design refresh C): a tinted panel with an icon tile, a
// title, a sentence or two, and an optional action at the right. It EXPLAINS
// and never refuses or confirms — that is `Notice`, with its role — so it has
// no role of its own and nothing in it is announced. No copy and no `t()`.
//
// The tint is primary at 5% over the page: the text on it is `foreground` and
// `muted-foreground`, whose ratios on the card and the page bracket it.

const Callout = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex min-w-0 flex-col gap-4 rounded-lg border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:p-5",
      className
    )}
    {...props}
  />
))
Callout.displayName = "Callout"

const CalloutBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex min-w-0 flex-1 items-start gap-3", className)}
    {...props}
  />
))
CalloutBody.displayName = "CalloutBody"

const CalloutTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm font-semibold", className)} {...props} />
))
CalloutTitle.displayName = "CalloutTitle"

const CalloutDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("mt-1 text-sm text-muted-foreground", className)}
    {...props}
  />
))
CalloutDescription.displayName = "CalloutDescription"

const CalloutAction = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex shrink-0 gap-2", className)} {...props} />
))
CalloutAction.displayName = "CalloutAction"

export { Callout, CalloutBody, CalloutTitle, CalloutDescription, CalloutAction }
