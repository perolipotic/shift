import * as React from "react"

import { cn } from "@/components/utils"

// Restyled once, here (visual refresh A): a 1.5px boundary in `--input` — the
// token held to 3:1 because it is the field's only affordance — on the card
// colour, and a 2px ring in `--ring`, primary's hue, which is measured at 3:1
// against that very boundary. Never the decorative border token, which is
// pinned below 3:1 on purpose.

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border-[1.5px] border-input bg-card px-3 py-1 text-base transition-[border-color,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
