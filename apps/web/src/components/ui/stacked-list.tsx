import * as React from "react"

import { cn } from "@/lib/utils"

// A table's phone form (story 7.6): below 640 px the Sati, Ljudi and
// shift-types tables render the SAME view model as a list of stacked rows, and
// only one of the two forms is ever in the DOM. Restyling `table`/`tr`/`td`
// with a `display` override would drop their roles in WebKit, so the honest
// semantics for a card is a list: `StackedList` is a `ul` named by the
// table's caption, `StackedRow` one `li`, and `StackedFields` a `dl` whose
// `StackedField`s pair every value (`dd`) with its column's own label (`dt`).
//
// THE LABEL IS NEVER DROPPED. Where the row's position already says what a
// value is (the name as the title, the team under it), the `dt` is `sr-only`
// (`labelHidden`), so assistive technology still announces each value with
// its column (Q22). Where the mockup shows the label, it is drawn small and
// muted above the value.
//
// Nothing here scrolls sideways: no `overflow-*`, and every part is `min-w-0`
// so long names wrap inside the row. A field is `wrap-anywhere`
// (`overflow-wrap: anywhere`), not `break-words`: only `anywhere` lowers the
// min-content width, and a name sits in an `inline-flex` link, a flex item
// that never shrinks below it. With `break-words` one unbroken word wider
// than a phone (a real surname, and the conflict picker's e2e member) keeps
// its full width and pushes the page sideways. No copy and no `t()`: the
// labels and the list's name come from the screen.

const StackedList = React.forwardRef<
  HTMLUListElement,
  React.HTMLAttributes<HTMLUListElement> & {
    /** The table's caption, from the screen's `t()`: the list's accessible name. */
    "aria-label": string
  }
>(({ className, ...props }, ref) => (
  <ul ref={ref} className={cn("grid min-w-0 divide-y", className)} {...props} />
))
StackedList.displayName = "StackedList"

const StackedRow = React.forwardRef<
  HTMLLIElement,
  React.LiHTMLAttributes<HTMLLIElement>
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    className={cn("relative grid min-w-0 gap-2 px-4 py-3 transition-colors hover:bg-muted/60", className)}
    {...props}
  />
))
StackedRow.displayName = "StackedRow"

const StackedFields = React.forwardRef<
  HTMLDListElement,
  React.HTMLAttributes<HTMLDListElement>
>(({ className, ...props }, ref) => (
  <dl ref={ref} className={cn("min-w-0", className)} {...props} />
))
StackedFields.displayName = "StackedFields"

export interface StackedFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The column's own label, from the screen's `t()`. */
  label: string
  /** Position carries the label: it stays for assistive technology only. */
  labelHidden?: boolean
  /** Drawn on one line after the previous field, behind a middle dot. */
  separated?: boolean
}

const StackedField = React.forwardRef<HTMLDivElement, StackedFieldProps>(
  ({ label, labelHidden = false, separated = false, className, children, ...props }, ref) => (
    <div
      ref={ref}
      data-separated={separated}
      className={cn(
        "min-w-0 wrap-anywhere data-[separated=true]:flex data-[separated=true]:before:px-1 data-[separated=true]:before:text-muted-foreground data-[separated=true]:before:content-['·']",
        className
      )}
      {...props}
    >
      <dt
        data-hidden={labelHidden}
        className="text-xs font-medium text-muted-foreground data-[hidden=true]:sr-only"
      >
        {label}
      </dt>
      <dd className="min-w-0 tabular-nums">{children}</dd>
    </div>
  )
)
StackedField.displayName = "StackedField"

/**
 * A skeleton row in the shape of the screen's row (UX-DR21): a title bar, a
 * shorter line under it, and `figures` blocks below or beside, never a
 * spinner. Decorative: the screen's `aria-busy` says the list is loading.
 */
function StackedSkeletonRow({
  avatar = false,
  figures = 0,
}: {
  avatar?: boolean
  figures?: number
}) {
  return (
    <li aria-hidden className="grid min-w-0 gap-2 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {avatar ? <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" /> : null}
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="h-4 w-2/5 animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-6 w-12 shrink-0 animate-pulse rounded-md bg-muted" />
      </div>
      {figures === 0 ? null : (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: figures }, (_, index) => (
            <div key={index} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}
    </li>
  )
}

export { StackedList, StackedRow, StackedFields, StackedField, StackedSkeletonRow }
