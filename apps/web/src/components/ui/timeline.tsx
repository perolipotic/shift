import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/components/utils"

// A day drawn as one bar (design refresh C): a scale of hours above it, its
// stretches in the bar, the boundaries between them labelled beneath, and a
// legend. No copy and no `t()`: every label is data the screen passes in, and
// the screen hides the whole drawing from assistive technology beside a text
// equivalent that states every figure it draws.
//
// NOTHING IS COLOUR ALONE. `light` and `dark` alternate so adjacent stretches
// read apart, and each stretch carries its band's name as text. The uncovered
// stretch (`TimelineGap`) is HATCHED as well as tinted, and the screen flags it
// in words besides. The two tones are pairs already measured elsewhere: the
// badge's primary tint with `foreground`, and the navy sidebar with its own
// foreground.
//
// Named parts rather than string props (`TimelineScale`, `TimelineBoundaries`,
// `TimelineGap`), so a screen composes them without a literal the string sweep
// in `prijava.test.ts` would have to exempt.

/** A labelled point along the bar. */
export interface TimelineMark {
  readonly key: string
  readonly label: string
  /** 0–100, how far along the bar. */
  readonly percent: number
}

const Timeline = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("grid min-w-0 gap-1.5", className)} {...props} />
))
Timeline.displayName = "Timeline"

/**
 * Labels positioned along the bar's width. The first and last are pinned to
 * the edges so neither overflows the card; every other one centres on its
 * point. A hairline tick points from each label at the bar.
 */
function TimelineMarks({
  marks,
  below,
}: {
  marks: readonly TimelineMark[]
  below: boolean
}) {
  return (
    <div className="relative h-6 min-w-0 text-xs tabular-nums text-muted-foreground">
      {marks.map((mark) => (
        <span
          key={mark.key}
          className={cn(
            "absolute flex -translate-x-1/2 items-center gap-1 whitespace-nowrap",
            below ? "top-0 flex-col-reverse" : "bottom-0 flex-col",
            mark.percent <= 0 && "translate-x-0 items-start",
            mark.percent >= 100 && "-translate-x-full items-end"
          )}
          style={{ left: `${String(mark.percent)}%` }}
        >
          <span>{mark.label}</span>
          <span className="h-1.5 w-px bg-input" />
        </span>
      ))}
    </div>
  )
}

/** The scale of hours, above the bar. */
function TimelineScale({ marks }: { marks: readonly TimelineMark[] }) {
  return <TimelineMarks marks={marks} below={false} />
}

/** The boundaries between stretches, beneath the bar. */
function TimelineBoundaries({ marks }: { marks: readonly TimelineMark[] }) {
  return <TimelineMarks marks={marks} below={true} />
}

const TimelineTrack = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex h-11 w-full min-w-0 overflow-hidden rounded-md border border-input", className)}
    {...props}
  />
))
TimelineTrack.displayName = "TimelineTrack"

const timelineToneVariants = cva("", {
  variants: {
    tone: {
      light: "bg-primary/15 text-foreground",
      dark: "bg-sidebar text-sidebar-foreground",
      uncovered: "hatch-uncovered",
    },
  },
  defaultVariants: { tone: "light" },
})

export type TimelineTone = NonNullable<VariantProps<typeof timelineToneVariants>["tone"]>

const TIMELINE_UNCOVERED: TimelineTone = "uncovered"

function TimelineSegment({
  tone,
  widthPercent,
  children,
}: {
  tone: TimelineTone
  widthPercent: number
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-center gap-1.5 border-r-2 border-card px-1 text-xs font-semibold last:border-r-0 [&_svg]:size-3.5 [&_svg]:shrink-0",
        timelineToneVariants({ tone })
      )}
      style={{ width: `${String(widthPercent)}%` }}
    >
      {children}
    </div>
  )
}

/** The stretch no band covers: hatched, and flagged in words by the screen. */
function TimelineGap({
  widthPercent,
  children,
}: {
  widthPercent: number
  children?: React.ReactNode
}) {
  return (
    <TimelineSegment tone={TIMELINE_UNCOVERED} widthPercent={widthPercent}>
      {children}
    </TimelineSegment>
  )
}

const TimelineLegend = React.forwardRef<
  HTMLUListElement,
  React.HTMLAttributes<HTMLUListElement>
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}
    {...props}
  />
))
TimelineLegend.displayName = "TimelineLegend"

function TimelineLegendItem({
  tone,
  children,
}: {
  tone: TimelineTone
  children?: React.ReactNode
}) {
  return (
    <li className="flex min-w-0 items-center gap-1.5">
      <span className={cn("size-2.5 shrink-0 rounded-full border border-input", timelineToneVariants({ tone }))} />
      <span className="truncate">{children}</span>
    </li>
  )
}

export {
  Timeline,
  TimelineScale,
  TimelineBoundaries,
  TimelineTrack,
  TimelineSegment,
  TimelineGap,
  TimelineLegend,
  TimelineLegendItem,
}
