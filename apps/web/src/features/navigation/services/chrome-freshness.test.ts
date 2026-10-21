import { describe, expect, it } from 'vitest';

import { chromeAnswerOf } from '@/features/navigation/services/chrome-freshness';
import type { FreshnessClock, ReadAnswer } from '@/lib/offline/freshness';

/** Story 8.2b: each chrome read decides its own freshness (human decision 2026-10-20, 2a). */

const STARTED = 1_000;
const AT_START: FreshnessClock = { online: true, freshAfter: STARTED, reconnected: false };
const RECONNECTED: FreshnessClock = { online: true, freshAfter: STARTED, reconnected: true };
const OFFLINE: FreshnessClock = { online: false, freshAfter: STARTED, reconnected: false };

function read<Data>(data: Data | undefined, overrides: Partial<ReadAnswer<Data>> = {}): ReadAnswer<Data> {
  return {
    data,
    dataUpdatedAt: data === undefined ? 0 : STARTED - 10,
    isError: false,
    isPending: data === undefined,
    fetchStatus: 'idle',
    ...overrides,
  };
}

describe('a chrome read online after the app start', () => {
  it('draws no restored value until it is read again', () => {
    expect(chromeAnswerOf(read('Ana', { fetchStatus: 'fetching' }), AT_START)).toMatchObject({
      data: undefined,
      isPending: true,
      isError: false,
    });
  });

  it('draws a value read after the start', () => {
    const fresh = read('Ana', { dataUpdatedAt: STARTED + 5 });

    expect(chromeAnswerOf(fresh, AT_START)).toBe(fresh);
  });

  it('fails a failed refetch over restored data with no data, so the restored value is never drawn', () => {
    // The role's notice and retry show, no navigation is built from a restored
    // role, and the name and the organization fall back.
    expect(chromeAnswerOf(read('Ana', { isError: true, fetchStatus: 'idle' }), AT_START)).toEqual({
      data: undefined,
      dataUpdatedAt: STARTED - 10,
      isError: true,
      isPending: false,
      fetchStatus: 'idle',
    });
  });

  it('passes a failed refetch over a value read after the start as it is', () => {
    const failed = read('Ana', { isError: true, fetchStatus: 'idle', dataUpdatedAt: STARTED + 5 });

    expect(chromeAnswerOf(failed, AT_START)).toBe(failed);
  });

  it('never leaves a restored value pending with no read in flight: it is failed, not drawn', () => {
    expect(chromeAnswerOf(read('Ana', { fetchStatus: 'idle' }), AT_START)).toMatchObject({
      data: undefined,
      isPending: false,
      isError: true,
      fetchStatus: 'idle',
    });
  });

  it('leaves a failed or missing read as it is', () => {
    const failed = read<string>(undefined, { isError: true, isPending: false });
    const missing = read<string>(undefined);

    expect(chromeAnswerOf(failed, AT_START)).toBe(failed);
    expect(chromeAnswerOf(missing, AT_START)).toBe(missing);
  });
});

describe('a chrome read after a reconnect', () => {
  it('keeps the value drawn while it is read again', () => {
    const cached = read('Ana', { fetchStatus: 'fetching' });

    expect(chromeAnswerOf(cached, RECONNECTED)).toBe(cached);
  });
});

describe('a chrome read offline', () => {
  it('draws the cached value, settled, so a paused refetch neither pulses nor refuses', () => {
    expect(chromeAnswerOf(read('Ana', { fetchStatus: 'paused', isError: true }), OFFLINE)).toEqual({
      data: 'Ana',
      dataUpdatedAt: STARTED - 10,
      isError: false,
      isPending: false,
      fetchStatus: 'idle',
    });
  });

  it('fails the role with nothing cached, so its notice and retry show rather than an endless skeleton', () => {
    expect(chromeAnswerOf(read(undefined, { fetchStatus: 'paused' }), OFFLINE, { required: true })).toMatchObject({
      data: undefined,
      isPending: false,
      isError: true,
      fetchStatus: 'idle',
    });
  });

  it('draws a cached role, required or not', () => {
    expect(chromeAnswerOf(read('admin', { fetchStatus: 'paused' }), OFFLINE, { required: true })).toMatchObject({
      data: 'admin',
      isError: false,
    });
  });

  it('settles a read with nothing cached as empty, so one missing read fails no other', () => {
    const name = read<string>(undefined, { fetchStatus: 'paused' });
    const role = read({ ok: true, role: 'admin' }, { fetchStatus: 'paused' });

    expect(chromeAnswerOf(name, OFFLINE)).toEqual({
      data: undefined,
      dataUpdatedAt: 0,
      isError: false,
      isPending: false,
      fetchStatus: 'idle',
    });
    expect(chromeAnswerOf(role, OFFLINE).data).toEqual({ ok: true, role: 'admin' });
  });

  it('never leaves an organization never cached pulsing: the lockup falls back', () => {
    const organization = read<{ ok: true }>(undefined, { fetchStatus: 'paused', isPending: true });

    expect(chromeAnswerOf(organization, OFFLINE)).toMatchObject({ data: undefined, isPending: false, isError: false });
  });
});
