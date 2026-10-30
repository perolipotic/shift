import { describe, expect, it } from 'vitest';

import { signInAddress } from '@/features/auth/services/address';
import {
  failureOfSwitch,
  organizationSwitchOf,
  runOrganizationSwitch,
  type OrganizationSwitchSteps,
} from '@/features/auth/services/organization-switch';
import { SIGN_OUT_FAILED } from '@/features/auth/services/sign-out';

describe('a sign-in link for another organization is offered, never followed silently (retro 10 A5)', () => {
  const inA = signInAddress('ana', 'dvd-a');

  it('offers the link organization when the session is in another one', () => {
    expect(organizationSwitchOf(inA, 'dvd-b')).toEqual({ current: 'dvd-a', target: 'dvd-b' });
  });

  it('compares normalized slugs, so a capitalized link to the same organization is followed', () => {
    expect(organizationSwitchOf(inA, 'DVD-A')).toBeNull();
    expect(organizationSwitchOf(inA, ' dvd-a ')).toBeNull();
    expect(organizationSwitchOf(inA, 'DVD-B')).toEqual({ current: 'dvd-a', target: 'dvd-b' });
  });

  it('follows the link as before when the session address does not parse', () => {
    expect(organizationSwitchOf(undefined, 'dvd-b')).toBeNull();
    expect(organizationSwitchOf(null, 'dvd-b')).toBeNull();
    expect(organizationSwitchOf('ana@example.com', 'dvd-b')).toBeNull();
  });

  it('decides nothing for a slug that can never name an organization', () => {
    expect(organizationSwitchOf(inA, 'under_score')).toBeNull();
  });
});

describe('the switch ends the session before it opens the other organization (retro 10 A5)', () => {
  function steps(overrides: Partial<OrganizationSwitchSteps> = {}) {
    const calls: string[] = [];
    const logged: unknown[] = [];
    const all: OrganizationSwitchSteps = {
      endSession: () => {
        calls.push('end');
        return Promise.resolve({ ok: true });
      },
      openTarget: () => {
        calls.push('open');
        return Promise.resolve();
      },
      reloadTarget: () => {
        calls.push('reload');
        return Promise.resolve();
      },
      log: (cause) => {
        logged.push(cause);
      },
      ...overrides,
    };
    return { all, calls, logged };
  }

  it('ends the session, then opens the form in the app', async () => {
    const { all, calls } = steps();

    expect(await runOrganizationSwitch(all)).toEqual({ kind: 'switched' });
    expect(calls).toEqual(['end', 'open']);
  });

  it('a refused end keeps the session and navigates nowhere', async () => {
    const { all, calls } = steps({
      endSession: () => Promise.resolve({ ok: false, code: SIGN_OUT_FAILED }),
    });

    expect(await runOrganizationSwitch(all)).toEqual({ kind: 'refused', code: SIGN_OUT_FAILED });
    expect(calls).toEqual([]);
  });

  it('an end that throws is a refusal, logged, and navigates nowhere', async () => {
    const thrown = new Error('no environment');
    const { all, calls, logged } = steps({ endSession: () => Promise.reject(thrown) });

    expect(await runOrganizationSwitch(all)).toEqual({ kind: 'refused', code: SIGN_OUT_FAILED });
    expect(calls).toEqual([]);
    expect(logged).toEqual([thrown]);
  });

  it('signed out but the navigation failed: a document load, never a failed sign-out', async () => {
    const thrown = new Error('navigation aborted');
    const { all, calls, logged } = steps({
      openTarget: () => {
        calls.push('open');
        return Promise.reject(thrown);
      },
    });

    expect(await runOrganizationSwitch(all)).toEqual({ kind: 'reloaded' });
    expect(calls).toEqual(['end', 'open', 'reload']);
    expect(logged).toEqual([thrown]);
  });

  it('a failed document load too is only logged: the person is signed out either way', async () => {
    const { all, logged } = steps({
      openTarget: () => Promise.reject(new Error('one')),
      reloadTarget: () => Promise.reject(new Error('two')),
    });

    expect(await runOrganizationSwitch(all)).toEqual({ kind: 'reloaded' });
    expect(logged).toHaveLength(2);
  });
});

describe('only a refused switch is put on screen', () => {
  it('maps each outcome', () => {
    expect(failureOfSwitch({ kind: 'refused', code: SIGN_OUT_FAILED })).toBe(SIGN_OUT_FAILED);
    expect(failureOfSwitch({ kind: 'switched' })).toBeNull();
    expect(failureOfSwitch({ kind: 'reloaded' })).toBeNull();
  });
});
