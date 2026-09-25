import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/components/utils"

// Restyled once, here, to DESIGN.md's register (visual refresh A): a 10px
// radius, semibold labels and a soft primary-tinted lift on hover. Screens size
// and place a Button (`h-11`, `w-full`) and never restyle it; heights stay the
// primitive's own so that the 44px floor remains a visible screen decision.
//
// The focus ring is offset from the control by the surface colour, so `--ring`
// is always drawn against the page rather than against a primary fill it
// cannot contrast with. `sidebar` is the navy chrome's own variant, with the
// ring that clears 3:1 on navy.
//
// BOTH BORDERED VARIANTS DRAW A 3:1 BOUNDARY. `outline` uses `--input`, the
// token held to 3:1 against the page for exactly this; `sidebar` uses the
// sidebar's own text colour at 50%, which `test/theme-contrast.test.ts`
// composites over `--sidebar` and holds to 3:1 in both themes — the
// `--sidebar-border` divider token measures about 1.2:1 there and is a
// divider, not a control's edge. `motion-reduce` drops the colour and shadow
// transitions for anybody who asked the OS for less motion.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[color,background-color,border-color,box-shadow] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md hover:shadow-primary/30",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border-[1.5px] border-input bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        // A place to drop or pick something (design refresh C): the outline's
        // measured `input` boundary, dashed, so it reads as a target.
        dashed:
          "border-[1.5px] border-dashed border-input bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        sidebar:
          "border-[1.5px] border-sidebar-foreground/50 bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring focus-visible:ring-offset-sidebar",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
