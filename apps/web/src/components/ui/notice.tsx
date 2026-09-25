import * as React from "react"
import { CircleAlert, CircleCheck } from "lucide-react"

import { cn } from "@/components/utils"

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
// A `<p>` with every other attribute passed through, so the `id`, `ref`,
// `tabIndex` and `aria-*` wiring screens depend on keeps working unchanged.

const NOTICE_ICONS = {
  alert: CircleAlert,
  status: CircleCheck,
} as const

export interface NoticeProps extends React.HTMLAttributes<HTMLParagraphElement> {
  role: keyof typeof NOTICE_ICONS
}

const Notice = React.forwardRef<HTMLParagraphElement, NoticeProps>(
  ({ className, role, children, ...props }, ref) => {
    const Icon = NOTICE_ICONS[role]
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
