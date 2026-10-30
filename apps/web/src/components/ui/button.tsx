import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Restyled once, here, to DESIGN.md's register (visual refresh A): the `md`
// radius (14px since story 15.1), semibold labels and a soft lift on hover. Screens size
// and place a Button (`h-11`, `w-full`) and never restyle it; heights stay the
// primitive's own so that the 44px floor remains a visible screen decision.
//
// The focus ring is offset from the control by the surface colour, so `--ring`
// is always drawn against the page rather than against a primary fill it
// cannot contrast with. `chrome` is the exception (story 15.2).
//
// `chrome` IS THE GLASS SHELL'S OWN VARIANT (story 15.2; it replaced the navy
// `sidebar` variant): borderless `foreground` text, a `glass-active` hover, and
// the ring with NO offset — an offset is an opaque band, and glass has no one
// colour to paint it in, so `--ring` is drawn straight against the glass,
// where `test/theme-contrast.test.ts` measures it against every glass
// backdrop. The sidebar's profile card is its one consumer.
//
// THE BORDERED VARIANTS DRAW A 3:1 BOUNDARY. `outline` and `dashed` use
// `--input`, the token held to 3:1 against the page, a card and every glass
// panel backdrop for exactly this. `motion-reduce` drops the colour and shadow
// transitions for anybody who asked the OS for less motion.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[color,background-color,border-color,box-shadow] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // INK since story 15.1 (D3): the one default action is near-black in
        // light and near-white in dark (`--ink`), and blue `primary` is kept
        // for selection, today, links and progress.
        default:
          "bg-ink text-ink-foreground shadow-sm hover:bg-ink/90 hover:shadow-md",
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
        chrome:
          "border-0 bg-transparent text-foreground hover:bg-glass-active/60 hover:text-foreground focus-visible:ring-offset-0",
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
        // Passed through unchanged: `keepFocusOnAlert` (story 8.2e) relies on its ref callback's cleanup.
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
