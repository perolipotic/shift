import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

// The one switch (story 13.5), on Radix: a `button` with `role="switch"` and
// `aria-checked`, toggled by Space or Enter, one tab stop. No copy and no
// `t()`: the screen labels it (a `Label` pointing at its id) and says what it
// does beside it. The track is 24 px; the screen sets it in a row at least
// 44 px tall whose label toggles it too, so the hit area is the row's.
//
// Off, the track is the card with a `--input` border — the token held to 3:1
// against the page — and the thumb `--input` too, so the control stays
// visible; on, the track fills with `--primary` and the thumb moves right.

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-[1.5px] border-input bg-card transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-input transition-transform motion-reduce:transition-none data-[state=checked]:translate-x-[1.375rem] data-[state=checked]:bg-primary-foreground"
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
