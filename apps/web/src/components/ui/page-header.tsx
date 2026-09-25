import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/components/utils"

// The page skeleton's head (visual refresh B), owned once here so every screen
// opens the same way: the title top-left, the screen's actions at the right,
// stacked under the title on a phone. No copy and no `t()`: a screen passes
// its own `<h1>{t('nav.x')}</h1>` into `PageTitle asChild`, which keeps the
// heading binding the route tests read off the `<h1>`.

const PageHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex min-w-0 flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between",
      className
    )}
    {...props}
  />
))
PageHeader.displayName = "PageHeader"

const PageTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  // `asChild` puts the classes on the screen's own `<h1>`.
  const Comp = asChild ? Slot : "h1"
  return (
    <Comp
      ref={ref}
      className={cn(
        "min-w-0 break-words font-heading text-2xl font-extrabold leading-tight tracking-tight",
        className
      )}
      {...props}
    />
  )
})
PageTitle.displayName = "PageTitle"

// The line under the title: what the screen is for, in one sentence. Muted,
// and never a second heading. A screen wraps its `PageTitle` and this in one
// `<div>` so they stay together on the left.
const PageDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("mt-1.5 max-w-prose text-sm text-muted-foreground", className)}
    {...props}
  />
))
PageDescription.displayName = "PageDescription"

const PageActions =React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-wrap gap-2", className)} {...props} />
))
PageActions.displayName = "PageActions"

export { PageHeader, PageTitle, PageDescription, PageActions }
