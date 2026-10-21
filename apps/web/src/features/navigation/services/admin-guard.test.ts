import { QueryClient } from '@tanstack/react-query';
import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';

import { guardMemberRole, requireAdmin } from '@/features/navigation/services/admin-guard';
import {
  MEMBER_ROLE_KEY,
  MEMBER_ROLE_UNAVAILABLE,
  cachedMemberRole,
  type MemberRoleOutcome,
  type MemberRoleReadOptions,
} from '@/features/navigation/services/role';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';

/**
 * The shared admin guard (B393), executed. `router.test.ts` drives it on every
 * registered admin route; this pins the read it is built on.
 */

const ADMIN: MemberRoleOutcome = { ok: true, role: 'admin' };

describe('the guard read', () => {
  it.each([
    { cause: 'enter', reuse: false },
    { cause: 'preload', reuse: false },
    { cause: 'stay', reuse: true },
    { cause: undefined, reuse: false },
  ] as const)('asks for a cached answer only while the route stays ($cause, E878)', async ({ cause, reuse }) => {
    const asked: (MemberRoleReadOptions | undefined)[] = [];

    await guardMemberRole({
      cause,
      context: {
        currentMemberRole: (options) => {
          asked.push(options);

          return Promise.resolve(ADMIN);
        },
      },
    });

    expect(asked).toEqual([{ reuse }]);
  });

  it('turns a rejection into an unavailable level, and logs why', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = new Error('READ_TIMED_OUT');

    try {
      expect(
        await guardMemberRole({ context: { currentMemberRole: () => Promise.reject(cause) } }),
      ).toEqual({ ok: false, code: MEMBER_ROLE_UNAVAILABLE });
      expect(logged).toHaveBeenCalledWith(MEMBER_ROLE_UNAVAILABLE, cause);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('the shared admin guard', () => {
  it('lets an administrator through', async () => {
    await expect(
      requireAdmin({ context: { currentMemberRole: () => Promise.resolve(ADMIN) } }),
    ).resolves.toBeUndefined();
  });

  it('forwards a member to the first destination, replacing the entry', async () => {
    let thrown: unknown = null;

    try {
      await requireAdmin({
        context: { currentMemberRole: () => Promise.resolve({ ok: true, role: 'member_role' }) },
      });
    } catch (caught) {
      thrown = caught;
    }

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to?: string; replace?: boolean } }).options).toMatchObject({
      to: DESTINATIONS[0].path,
      replace: true,
    });
  });
});

describe('the shared admin guard offline (story 8.2b)', () => {
  /** A read that never settles: the network a paused fetch waits for. */
  const NEVER = () => new Promise<MemberRoleOutcome>(() => undefined);

  it('opens the route on the level cached on the device, with no read', async () => {
    const cache = new QueryClient();

    cache.setQueryData(MEMBER_ROLE_KEY, ADMIN);

    await expect(
      requireAdmin({ cause: 'enter', context: { currentMemberRole: cachedMemberRole(cache, NEVER, () => false) } }),
    ).resolves.toBeUndefined();
  });

  it('fails closed at once with no level cached, to the first destination, never an endless pending', async () => {
    // FAKE TIMERS, NONE ADVANCED: a guard that waited on a timer — a time
    // budget, a retry delay — would never settle here, and the test would time out.
    vi.useFakeTimers();

    try {
      const thrown = await requireAdmin({
        cause: 'enter',
        context: { currentMemberRole: cachedMemberRole(new QueryClient(), NEVER, () => false) },
      }).then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(vi.getTimerCount(), 'the guard scheduled a timer').toBe(0);
      expect(isRedirect(thrown)).toBe(true);
      expect((thrown as { options: { to?: string; replace?: boolean } }).options).toMatchObject({
        to: DESTINATIONS[0].path,
        replace: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
