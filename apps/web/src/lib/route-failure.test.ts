import { describe, expect, it, vi } from 'vitest';

import { ROUTE_FAILED, reportRouteFailure } from '@/lib/route-failure';

describe('a failed route is reported, never shown', () => {
  it('logs the cause under the stable code', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = new Error('render threw');

    try {
      reportRouteFailure(cause);

      expect(logged).toHaveBeenCalledWith(ROUTE_FAILED, cause);
    } finally {
      logged.mockRestore();
    }
  });
});
