import * as React from "react"

import { CheckCircle, WarningCircle, WifiSlash } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

// The one refusal and confirmation box (visual refresh B), in the Input look:
// a 1.5px `input` border on the card colour. No copy and no `t()`: the screen
// passes its own message as children.
//
// THE VARIANT IS THE ROLE, so the two cannot disagree. `role="alert"` is a
// refusal and draws a warning icon; `role="status"` is a confirmation and draws
// a check. Error and success therefore differ by a shape as well as by their
// words, never by colour, and `destructive` stays reserved for conflicts. The
// icon is decorative and hidden from assistive technology with the bare
// boolean `aria-hidden`; the role announces the message.
//
// ONE MORE SHAPE, STORY 8.2: the OFFLINE variant is a `role="status"` with a
// WifiOff icon — the as-of note over a snapshot drawn from the device. It is a
// status, not a refusal, and the crossed-out signal tells it from a
// confirmation's check. Only a status can be offline, which the type enforces.
//
// A `<p>` with every other attribute passed through, so the `id`, `ref`,
// `tabIndex` and `aria-*` wiring screens depend on keeps working unchanged.

const NOTICE_ICONS = {
  alert: WarningCircle,
  status: CheckCircle,
} as const

export type NoticeProps = React.HTMLAttributes<HTMLParagraphElement> &
  (
    | { role: "alert"; variant?: never }
    | { role: "status"; variant?: "offline" }
  )

const Notice = React.forwardRef<HTMLParagraphElement, NoticeProps>(
  ({ className, role, variant, children, ...props }, ref) => {
    const Icon = variant === "offline" ? WifiSlash : NOTICE_ICONS[role]
    return (
      <p
        ref={ref}
        role={role}
        className={cn(
          "flex items-start gap-2 rounded-md border-[1.5px] border-input bg-card px-3 py-2.5 text-sm font-medium",
          className
        )}
        {...props}
      >
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">{children}</span>
      </p>
    )
  }
)
Notice.displayName = "Notice"

export { Notice }
