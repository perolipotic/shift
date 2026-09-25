import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/components/utils"

// A pill badge (visual refresh B). ITS MEANING IS ITS TEXT: a badge always
// carries the word it stands for and the variant only reinforces it, so no
// state is carried by colour alone. Three variants and no status colours:
// green, amber and red would imply semantics the product has not defined, and
// `destructive` is reserved for conflicts.
//
// `default` is a primary TINT, `bg-primary/15`, with its text in `foreground`,
// measured against the card in both themes by `test/theme-contrast.test.ts`,
// which reads every variant's classes from this file, on the card and on a
// hovered row. NOT `text-primary`: the dark theme's primary misses 4.5:1 on the
// dark card even untinted (asserted there), every tint only lowers it, and a
// new colour token is a decision for the design owner.

const badgeVariants = cva(
  "inline-flex max-w-full items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border border-input text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
