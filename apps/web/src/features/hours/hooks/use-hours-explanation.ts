import type { HoursFigureCode } from '@shift/domain';
import { useState } from 'react';

import type { HoursExplainRequest, HoursExplanationView } from '@/features/hours/services/hours-explanation';
import { usePhone } from '@/hooks/viewport';

/** The explanation dialog's state: whether it is open, and what it shows. */
export interface HoursExplanationDialogState {
  readonly open: boolean;
  readonly explanation: HoursExplanationView | null;
}

/**
 * The explanation dialog behind a figure's ⓘ (story 7.14), held by the screen
 * ABOVE every branch of *Sati* — the figures, the message, the skeleton — so
 * the dialog is never unmounted open: a native `<dialog>` restores focus to
 * the ⓘ that opened it only when it is `close()`d. `dialog` is `null` until a
 * first ⓘ is chosen, then kept, closed through `open`.
 *
 * ITS CONTENT IS WORKED OUT ONCE, AS IT OPENS (`ask`), and held: a re-read of
 * *Sati* never redraws an open dialog (the Dialog's rule), and nothing is
 * explained on a render.
 *
 * IT CLOSES WHEN ITS ⓘ IS GONE, in the same render, so it never re-opens when
 * the figures come back: when the figures leave (`figuresShown` false — a
 * refusal, a failed read, the skeleton), and when the organization's month
 * crosses 640 px, since its ⓘ is in the layout it was opened in alone (the
 * table's or the stacked rows'). A member's own figures keep their ⓘs in both
 * layouts. Focus then goes where the browser puts it; returning it to the
 * matching ⓘ of the other layout is not attempted.
 */
export function useHoursExplanation(
  explain: (request: HoursExplainRequest) => HoursExplanationView | null,
  {
    figuresShown,
    organization,
  }: {
    /** Whether the figures — and so the ⓘs — are on the page. */
    readonly figuresShown: boolean;
    /** Whether they are the organization's month, whose ⓘs change with the layout. */
    readonly organization: boolean;
  },
) {
  const isPhone = usePhone();
  const [state, setState] = useState<(HoursExplanationDialogState & { readonly phone: boolean }) | null>(null);
  const orphaned = state !== null && state.open && (!figuresShown || (organization && state.phone !== isPhone));

  // React's adjust-state-while-rendering: no effect, no frame with it open.
  if (orphaned) setState({ ...state, open: false });

  function ask(memberId: string | null, figure: HoursFigureCode): void {
    setState({ open: true, phone: isPhone, explanation: explain({ memberId, figure }) });
  }

  function close(): void {
    setState((current) => (current === null ? null : { ...current, open: false }));
  }

  const dialog: HoursExplanationDialogState | null =
    state === null ? null : { open: state.open && !orphaned, explanation: state.explanation };

  return { dialog, ask, close };
}
