import { describe, expect, it } from 'vitest';

import { claimedOrganizationOf } from '@/lib/supabase/claims';

const ORGANIZATION = '00000000-0000-4000-8000-000000000001';

describe('the organization comes from the session claim', () => {
  function token(payload: unknown): string {
    const encoded = btoa(JSON.stringify(payload))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');

    return `header.${encoded}.signature`;
  }

  it('reads the claim', () => {
    expect(claimedOrganizationOf(token({ organization_id: ORGANIZATION }))).toBe(ORGANIZATION);
  });

  it.each([
    ['no token', null],
    ['undefined', undefined],
    ['no payload', 'header'],
    ['an empty payload', 'header..signature'],
    ['a payload that is not JSON', 'header.bm90LWpzb24.signature'],
    ['a payload that is not base64', 'header.%%%.signature'],
    ['no claim', token({ sub: 'x' })],
    ['an empty claim', token({ organization_id: '' })],
    ['a numeric claim', token({ organization_id: 7 })],
    ['an array payload', token([1])],
    ['a null payload', token(null)],
  ])('answers null for %s', (_what, value) => {
    expect(claimedOrganizationOf(value)).toBeNull();
  });
});
