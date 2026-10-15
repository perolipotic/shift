import { describe, expect, it, vi } from 'vitest';

import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { followErasureCheck, type ErasureConfirmSteps } from '@/features/conflicts/services/erasure-confirm';
import {
  RECHECK_CHANGED,
  RECHECK_PROCEED,
  recheckOf,
  type ErasureRow,
  type Recheck,
} from '@/features/conflicts/services/erasures';

/** The erasure confirmation's one order, shared by every guarded surface (retro A15), executed (AD-15). */

type Check =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: string }
  | { readonly kind: typeof CHECK_READY; readonly rows: readonly ErasureRow[] };

const row = (key: string): ErasureRow => ({
  key,
  memberId: 'm',
  date: '2026-09-10',
  teamId: 't',
  memberName: 'Ana',
  teamName: 'A',
  weekday: 'četvrtak',
  dayMonth: '10.09.',
  shiftTypeName: 'Dnevna',
  teamWorks: false,
});

const SHOWN = [row('a')];
const SUBJECT = { draft: 'shown' };

/** Steps that record what ran, in order. */
function recorded(overrides: Partial<ErasureConfirmSteps<Check, typeof SUBJECT>> = {}) {
  const ran: string[] = [];
  const steps: ErasureConfirmSteps<Check, typeof SUBJECT> = {
    unavailable: () => {
      ran.push('unavailable');
    },
    refused: ({ code }) => {
      ran.push(`refused:${code}`);
    },
    write: ({ rows }, subject) => {
      ran.push(`write:${rows.length}:${subject.draft}`);
    },
    ...overrides,
  };

  return { ran, steps };
}

const recheck = (rows: readonly ErasureRow[]) => recheckOf(SHOWN, rows);

describe('followErasureCheck', () => {
  it('writes the same list as shown, with its rows and the shown subject', async () => {
    const { ran, steps } = recorded();

    await followErasureCheck<Check, typeof SUBJECT>({ kind: CHECK_READY, rows: [row('a')] }, SUBJECT, recheck, steps);

    expect(ran).toEqual(['write:1:shown']);
  });

  it('writes when the conflicts are gone meanwhile', async () => {
    const { ran, steps } = recorded();

    await followErasureCheck<Check, typeof SUBJECT>({ kind: CHECK_READY, rows: [] }, SUBJECT, recheck, steps);

    expect(ran).toEqual(['write:0:shown']);
  });

  it('writes nothing when the list changed: the recheck shows it again', async () => {
    const { ran, steps } = recorded();
    const shownAgain = vi.fn(recheck);

    await followErasureCheck<Check, typeof SUBJECT>(
      { kind: CHECK_READY, rows: [row('a'), row('b')] },
      SUBJECT,
      shownAgain,
      steps,
    );

    expect(ran).toEqual([]);
    expect(shownAgain).toHaveReturnedWith(RECHECK_CHANGED);
  });

  it('refuses unavailable with no write and no recheck', async () => {
    const { ran, steps } = recorded();
    const judged = vi.fn(recheck);

    await followErasureCheck<Check, typeof SUBJECT>({ kind: CHECK_UNAVAILABLE }, SUBJECT, judged, steps);

    expect(ran).toEqual(['unavailable']);
    expect(judged).not.toHaveBeenCalled();
  });

  it("refuses with the write's own refusal, awaited", async () => {
    const { ran, steps } = recorded({
      refused: async ({ code }) => {
        await Promise.resolve();
        ran.push(`refused:${code}`);
      },
    });

    await followErasureCheck<Check, typeof SUBJECT>({ kind: CHECK_REFUSED, code: 'stale' }, SUBJECT, recheck, steps);

    expect(ran).toEqual(['refused:stale']);
  });

  it('stops before anything when the screen moved on, synchronously or after its own await', async () => {
    for (const stopped of [() => true, () => Promise.resolve(true)]) {
      const { ran, steps } = recorded({ stopped });

      for (const check of [
        { kind: CHECK_UNAVAILABLE },
        { kind: CHECK_REFUSED, code: 'x' },
        { kind: CHECK_READY, rows: SHOWN },
      ] satisfies Check[]) {
        await followErasureCheck<Check, typeof SUBJECT>(check, SUBJECT, recheck, steps);
      }

      expect(ran).toEqual([]);
    }
  });

  it('carries on when the screen is still where it was', async () => {
    const stopped = vi.fn(() => false);
    const { ran, steps } = recorded({ stopped });

    await followErasureCheck<Check, typeof SUBJECT>({ kind: CHECK_READY, rows: SHOWN }, SUBJECT, recheck, steps);

    expect(stopped).toHaveBeenCalledWith({ kind: CHECK_READY, rows: SHOWN });
    expect(ran).toEqual(['write:1:shown']);
  });

  it('judges and writes the subject the surface rebuilt from the fresh check', async () => {
    const judged = vi.fn((_rows: readonly ErasureRow[], _subject: typeof SUBJECT): Recheck => RECHECK_PROCEED);
    const { ran, steps } = recorded({ subjectOf: () => ({ draft: 'fresh' }) });

    await followErasureCheck<Check, typeof SUBJECT>({ kind: CHECK_READY, rows: SHOWN }, SUBJECT, judged, steps);

    expect(judged).toHaveBeenCalledWith(SHOWN, { draft: 'fresh' });
    expect(ran).toEqual(['write:1:fresh']);
  });

  it('stops when the surface refused the fresh subject itself, before the recheck', async () => {
    const judged = vi.fn(recheck);
    const { ran, steps } = recorded({ subjectOf: () => null });

    await followErasureCheck<Check, typeof SUBJECT>({ kind: CHECK_READY, rows: SHOWN }, SUBJECT, judged, steps);

    expect(judged).not.toHaveBeenCalled();
    expect(ran).toEqual([]);
  });

  it('lets a throwing step reach the caller, whose catch says it', async () => {
    const { steps } = recorded({
      write: () => Promise.reject(new Error('500')),
    });

    await expect(
      followErasureCheck<Check, typeof SUBJECT>({ kind: CHECK_READY, rows: SHOWN }, SUBJECT, recheck, steps),
    ).rejects.toThrow('500');
  });

});
