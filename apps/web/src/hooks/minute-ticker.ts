import { useEffect, useState } from 'react';

/** How often the clock is read again: once a minute, a duty's finest figure. */
const TICK_MS = 60_000;

/** The browser's name for a page shown again. */
const VISIBLE = 'visible';

/**
 * The clock, read again on every minute boundary (story 6.2): a timeout to
 * the next whole minute, then an interval of {@link TICK_MS}, so a duty's
 * remaining time turns over with the wall clock, not up to a minute late. A
 * tab shown again reads it at once — a phone's timers sleep in the
 * background. A tab left open past midnight moves to the new day, without a
 * reload. The timeout, the interval and the listener are all removed on
 * unmount.
 */
export function useMinuteTicker(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = (): void => {
      setNow(new Date());
    };
    const boundary = setTimeout(() => {
      tick();
      interval = setInterval(tick, TICK_MS);
    }, TICK_MS - (Date.now() % TICK_MS));
    const onVisibility = (): void => {
      if (document.visibilityState === VISIBLE) tick();
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(boundary);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return now;
}
