import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/components/utils"

// The one select, and still the NATIVE `<select>`: it brings keyboard
// behaviour on every platform, an accessible name through its `<Label>`, a
// phone's own picker sheet, and a value `FormData` reads — so `defaultValue`,
// `ref` and the key-remounts the screens rely on (UX-DR34) keep working. A
// styled listbox would have to reimplement all of it.
//
// The Input look, written once: the 1.5px `--input` boundary, the card colour,
// the `--ring` focus ring and the dimmed disabled state `input.tsx` draws. The
// browser's arrow is replaced by a decorative chevron so it matches the theme
// in both modes; `pr-9` keeps the longest option clear of it.
//
// `h-9` like `Input`: the screen composes `h-11` through `className`, which is
// where the 44 px sweep reads it. `className` and every attribute go to the
// `<select>` itself; the wrapper only positions the chevron.

const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => {
    return (
      <div className="relative min-w-0">
        <select
          className={cn(
            "flex h-9 w-full appearance-none rounded-md border-[1.5px] border-input bg-card py-1 pl-3 pr-9 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          ref={ref}
          {...props}
        />
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    )
  }
)
Select.displayName = "Select"

export { Select }
