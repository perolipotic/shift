import { useEffect, useRef, type ReactNode } from 'react';

import { STICKY_HEAD_HEIGHT_VAR, stickyHeadHeightOf } from '@/utils/sticky-head';

/**
 * THE PHONE'S STICKY HEAD of *Kalendar* and *Sati* (deferred-work E816): the
 * month toolbar and the filter bar under it, held at the top of the viewport
 * below 640 px while the month scrolls, and in flow from 640 px up, where the
 * sidebar leaves room for the page to scroll them away.
 *
 * Its height, live, is `--sticky-head` on the root while it is mounted: the
 * page's scroll padding clears it (`index.css`), so a cell or a control
 * revealed by `scrollIntoView` lands below it rather than under it, and the
 * calendar's grid bounds its scroller by it, so the team header stays in view
 * between the head and the bottom bar.
 *
 * It sits inside the screen's Card: a sticky element sticks within its
 * container, so it leaves with the Card and never covers what follows it.
 */
export function StickyHead({ children }: { readonly children: ReactNode }): ReactNode {
  const head = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = head.current;

    if (element === null) return;

    const root = document.documentElement;
    const measure = (): void => {
      root.style.setProperty(STICKY_HEAD_HEIGHT_VAR, stickyHeadHeightOf(element.getBoundingClientRect().height));
    };

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(element);

    return () => {
      observer.disconnect();
      root.style.removeProperty(STICKY_HEAD_HEIGHT_VAR);
    };
  }, []);

  return (
    <div
      ref={head}
      data-sticky-head
      className="min-w-0 max-sm:sticky max-sm:top-0 max-sm:z-20 max-sm:rounded-t-lg max-sm:border-b max-sm:bg-card"
    >
      {children}
    </div>
  );
}
