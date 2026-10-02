import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"

import { cn } from "@/lib/utils"

// The one radio group (story 5.4b), on Radix: one tab stop for the group, the
// arrow keys move between its items and Space selects, as UX-DR38 asks. No
// copy and no `t()`: the screen labels the group and passes each item's words.
//
// `RadioCard` is the `resolution-option` card (DESIGN.md): a whole card is the
// radio, its own words inside it. Nothing is preselected and no card is
// primary-styled; the CHOSEN one gets a primary border plus a ring and a
// filled dot, never a different fill. The dot's ring uses `--input`, the token
// held to 3:1 against the page, so an unchosen card's control stays visible.

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-3", className)} {...props} />
))
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

/** The dot every item draws: an outlined circle, filled while chosen. */
function RadioDot() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-input bg-card group-data-[state=checked]:border-primary"
    >
      <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-primary" />
    </span>
  )
}

const RadioCard = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & {
    /** Drawn under the dot and the words, across the card's whole width. */
    footer?: React.ReactNode
  }
>(({ className, children, footer, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "group grid w-full min-w-0 gap-3 rounded-lg border-[1.5px] border-input bg-card p-3 text-left text-card-foreground transition-[border-color,box-shadow] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:ring-2 data-[state=checked]:ring-primary sm:p-4",
      className
    )}
    {...props}
  >
    <span className="flex min-w-0 items-start gap-3">
      <RadioDot />
      <span className="grid min-w-0 flex-1 gap-1">{children}</span>
    </span>
    {footer}
  </RadioGroupPrimitive.Item>
))
RadioCard.displayName = "RadioCard"

export { RadioGroup, RadioCard }
