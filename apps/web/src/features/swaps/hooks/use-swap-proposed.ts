import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import {
  swapProposedOf,
  swapProposedStepOf,
  swapProposedValuesOf,
  withoutSwapProposed,
  type SwapProposed,
} from '@/features/swaps/services/swap-proposal';

/**
 * The status line *Kalendar* shows after a landed proposal (story 12.2),
 * naming the date, the shift and the colleague: the form hands it over in the
 * history entry's state (`withSwapProposed`), and the location that brings it
 * shows it and clears it off the entry, keeping the month — so a reload or
 * Back finds none (`swapProposedStepOf`, the *Godišnji* sent line's rule). It
 * takes focus once drawn, so it is announced.
 */
export function useSwapProposed() {
  const location = useLocation();
  const navigate = useNavigate();
  const [proposed, setProposed] = useState<SwapProposed | null>(() => swapProposedOf(location.state));
  /** Whether the next location is our own clearing replace. */
  const clearing = useRef(false);
  /** The location state already stepped over: an effect run twice steps once. */
  const stepped = useRef<unknown>(undefined);
  const lineField = useRef<HTMLParagraphElement>(null);
  const state = location.state;

  useEffect(() => {
    if (stepped.current === state) return;

    stepped.current = state;

    const step = swapProposedStepOf(proposed, state, clearing.current);

    clearing.current = step.clearing;
    setProposed(step.shown);
    if (step.clear) {
      void navigate({
        to: '/kalendar',
        search: (current) => current,
        replace: true,
        state: (entry) => withoutSwapProposed(entry),
      });
    }
  }, [state, proposed, navigate]);

  useEffect(() => {
    if (proposed !== null) lineField.current?.focus();
  }, [proposed]);

  return { proposed: proposed === null ? null : swapProposedValuesOf(proposed), lineField };
}
