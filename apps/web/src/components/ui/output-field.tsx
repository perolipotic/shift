import * as React from "react"

import { cn } from "@/components/utils"

// A computed value shown where a field would be (design refresh C): the same
// height and radius as `Input`, so it lines up beside one, but DASHED and on
// `muted`, so it never reads as something to type into. A native `<output>`,
// labelled by its `<Label>` and tied by `htmlFor` to the fields it is computed
// from, and polite by default, so a changed value is read out without
// interrupting whoever is typing.

const OutputField = React.forwardRef<
  HTMLOutputElement,
  React.OutputHTMLAttributes<HTMLOutputElement>
>(({ className, ...props }, ref) => (
  <output
    ref={ref}
    aria-live="polite"
    className={cn(
      "flex h-11 w-full min-w-0 items-center gap-2 rounded-md border-[1.5px] border-dashed border-input bg-muted px-3 text-sm tabular-nums [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
      className
    )}
    {...props}
  />
))
OutputField.displayName = "OutputField"

export { OutputField }
