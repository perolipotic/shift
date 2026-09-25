import * as React from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/components/utils"

// The one modal (design refresh C), on the NATIVE `<dialog>` and its
// `showModal()`: the browser supplies the focus trap, the inert page behind
// it, Escape to close, the top layer and the return of focus to whatever
// opened it — four behaviours a hand-rolled overlay gets subtly wrong and no
// dependency is needed for. `open` is the screen's state; the element follows
// it, and every way the browser closes it (Escape, `close()`) reports back
// through `onOpenChange(false)`.
//
// A click on the BACKDROP closes it too: the backdrop is the dialog element
// itself outside its content box, so only a click whose target is the element
// counts. The content fills the element, so a click inside never is.
//
// CLOSED MEANS HIDDEN, NOT UNMOUNTED. A closed `<dialog>` is `display: none`
// and its children stay mounted, so an uncontrolled form inside keeps its
// refs and, after a refusal, its values (UX-DR34).
//
// No copy and no `t()`: the close button's name is the screen's `closeLabel`.

export interface DialogProps
  extends Omit<React.DialogHTMLAttributes<HTMLDialogElement>, "open"> {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * `false` while something is in flight: Escape and the backdrop then do
   * nothing, so a request cannot lose the dialog that reports its outcome.
   */
  dismissible?: boolean
}

function Dialog({
  open,
  onOpenChange,
  dismissible = true,
  className,
  children,
  ...props
}: DialogProps) {
  const element = React.useRef<HTMLDialogElement>(null)

  React.useEffect(() => {
    const dialog = element.current

    if (dialog === null) return

    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={element}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault()
      }}
      onClose={() => {
        if (open) onOpenChange(false)
      }}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onOpenChange(false)
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border bg-card p-0 text-card-foreground shadow-sh-lg backdrop:bg-sidebar/60",
        className
      )}
      {...props}
    >
      {/* ONE SHRINKABLE COLUMN: without it the grid grows to its widest
          child — a long, unwrapped button label — and the prompt overflows. */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 p-6">{children}</div>
    </dialog>
  )
}

function DialogHeader({
  className,
  closeLabel,
  closeRef,
  onClose,
  children,
}: {
  className?: string
  /** The close button's accessible name, from the screen's `t()`. */
  closeLabel: string
  /** For a screen that must move focus to the close button, e.g. after a removal. */
  closeRef?: React.Ref<HTMLButtonElement>
  onClose: () => void
  children?: React.ReactNode
}) {
  return (
    <div className={cn("-mr-3 -mt-3 flex items-start justify-between gap-4", className)}>
      <div className="grid min-w-0 gap-1.5 pt-3">{children}</div>
      <Button
        ref={closeRef}
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0"
        aria-label={closeLabel}
        onClick={onClose}
      >
        <X aria-hidden />
      </Button>
    </div>
  )
}

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("font-heading text-lg font-bold leading-tight tracking-tight", className)}
    {...props}
  />
))
DialogTitle.displayName = "DialogTitle"

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
DialogDescription.displayName = "DialogDescription"

const DialogFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:max-w-full",
      className
    )}
    {...props}
  />
))
DialogFooter.displayName = "DialogFooter"

/**
 * A confirmation as its own small modal: open for as long as the screen
 * renders it, so a screen keeps its "armed" state exactly as it had it and
 * renders this where the inline confirmation used to be. The children are the
 * prompt (the element `aria-labelledby` names) and a `DialogFooter` with the
 * cancel and the confirm. Escape and the backdrop cancel — except while
 * `busy`, when nothing but the request's end closes it.
 */
function ConfirmDialog({
  busy,
  onCancel,
  children,
  ...props
}: Omit<DialogProps, "open" | "onOpenChange" | "dismissible"> & {
  busy: boolean
  onCancel: () => void
}) {
  return (
    <Dialog
      open={true}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
      dismissible={!busy}
      {...props}
    >
      {children}
    </Dialog>
  )
}

export { Dialog, ConfirmDialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter }
