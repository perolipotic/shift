import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/components/utils"

// A rounded square holding one icon (design refresh C): beside a row's name, a
// stat's label or a card's title. DECORATIVE ALWAYS. The tile is hidden from
// assistive technology and the words beside it carry the meaning, so a tile is
// never the only thing that says what a row is.
//
// `light` and `dark` are the hour band tones, the same pairs the day timeline
// draws its stretches in, so a row and its stretch match: `light` is the
// badge's measured primary tint, `dark` the navy sidebar pair. `primary` tints
// an info surface's icon; `muted` is the neutral default.

const iconTileVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        muted: "bg-muted text-muted-foreground",
        primary: "bg-primary/15 text-foreground",
        light: "bg-primary/15 text-foreground",
        dark: "bg-sidebar text-sidebar-foreground",
      },
      size: {
        default: "size-10 [&_svg]:size-5",
        sm: "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "muted",
      size: "default",
    },
  }
)

export interface IconTileProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof iconTileVariants> {}

function IconTile({ className, variant, size, ...props }: IconTileProps) {
  return (
    <span
      aria-hidden
      className={cn(iconTileVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { IconTile, iconTileVariants }
