import { useEffect, useRef, useState, type ReactNode } from 'react';

import { STICKY_HEAD_HEIGHT_VAR, filtersCoveredBy, stickyHeadHeightOf } from '@/utils/sticky-head';

/**
 * THE PHONE'S STICKY HEAD of *Kalendar* and *Sati* (deferred-work E816): the
 * month toolbar, held at the top of the viewport below 640 px while the month
 * scrolls, and in flow from 640 px up, where the sidebar leaves room for the
 * page to scroll it away. The filter bar is NOT in it: it follows in flow, so
 * the head stays one toolbar high.
 *
 * `summary` is the active filters as one line (`null` with none on). Once the
 * filter bar has scrolled up under the head, that line shows under the
 * toolbar — drawn OVER the content, not in flow, so its coming and going never
 * moves the page — and it is `aria-hidden`: the bar's own summary is the
 * `role="status"` line, and saying it twice would be noise.
 *
 * Its height, live, plus room for that line, is `--sticky-head` on the root
 * while it is mounted: the page's scroll padding clears it (`index.css`), so a
 * cell or a control revealed by `scrollIntoView` lands below it rather than
 * under it, and the calendar's grid bounds its scroller by it, so the team
 * header stays in view below it.
 *
 * It sits inside the screen's Card: a sticky element sticks within its
 * container, so it leaves with the Card and never covers what follows it.
 *
 * GLASS ON A PHONE (story 15.1): the month scrolls UNDER the head there, so it
 * is `glass-over-content`, one of the three layers a phone may blur, and what
 * it holds is foreground-strength text on opaque controls. The summary line
 * under it stays on the opaque card, so its muted text is measured on one
 * known colour.
 */
export function StickyHead({
  summary = null,
  children,
}: {
  readonly summary?: string | null;
  readonly children: ReactNode;
}): ReactNode {
  const head = useRef<HTMLDivElement>(null);
  const [covered, setCovered] = useState(false);
  const withSummary = summary !== null;

  useEffect(() => {
    const element = head.current;

    if (element === null) return;

    const root = document.documentElement;
    const measure = (): void => {
      root.style.setProperty(
        STICKY_HEAD_HEIGHT_VAR,
        stickyHeadHeightOf(element.getBoundingClientRect().height, withSummary),
      );
    };

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(element);

    return () => {
      observer.disconnect();
      root.style.removeProperty(STICKY_HEAD_HEIGHT_VAR);
    };
  }, [withSummary]);

  // Whether the filter bar right after the head has scrolled up under it.
  useEffect(() => {
    const element = head.current;

    if (element === null || summary === null) {
      setCovered(false);

      return;
    }

    const check = (): void => {
      const next = element.nextElementSibling;

      setCovered(
        next !== null &&
          filtersCoveredBy(element.getBoundingClientRect().bottom, next.getBoundingClientRect().bottom),
      );
    };

    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);

    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [summary]);

  return (
    <div
      ref={head}
      data-sticky-head
      className="min-w-0 max-sm:sticky max-sm:top-0 max-sm:z-20 max-sm:rounded-t-lg max-sm:border-b max-sm:glass-over-content"
    >
      {children}
      {summary !== null && covered ? (
        <p
          aria-hidden
          data-sticky-summary
          className="absolute inset-x-0 top-full truncate border-b bg-card px-4 py-1 text-xs text-muted-foreground tabular-nums sm:hidden"
        >
          {summary}
        </p>
      ) : null}
    </div>
  );
}
