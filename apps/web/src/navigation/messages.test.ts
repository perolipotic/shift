import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { navigationMessageKey } from '@/navigation/messages';
import {
  MEMBER_ROLE_REFUSED,
  MEMBER_ROLE_UNAVAILABLE,
  MEMBER_ROLE_UNRECOGNISED,
  type MemberRoleFailure,
} from '@/navigation/role';
import { SIGN_OUT_FAILED, type SignOutFailure } from '@/supabase/sign-out';

/**
 * The chrome's failure-to-message pairing, EXECUTED.
 *
 * The mapping would otherwise be a ternary inside `chrome.tsx`, where AD-15
 * leaves nothing to run it: swapping two branches passes every source-level
 * assertion in this repository while a refused sign-out reports that navigation
 * could not be loaded and a broken role read tells somebody their sign-out
 * failed. Both are directly actionable and both send the person the wrong way —
 * the second one worst of all, because it says a live session has ended.
 *
 * `sign-in.test.ts` established this block's shape; this is the third mapping in
 * the application to carry one.
 */

const RESOURCE = join(
  fileURLToPath(new URL('..', import.meta.url)),
  'i18n',
  'locales',
  'hr.json',
);

/** One message by its dotted key path, or `undefined`. */
function messageAt(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      JSON.parse(readFileSync(RESOURCE, 'utf8')),
    );
}

describe('every code names a message, and the resource file declares it', () => {
  it.each<{ code: MemberRoleFailure | SignOutFailure; key: string }>([
    { code: MEMBER_ROLE_REFUSED, key: 'shell.error.destinations' },
    { code: MEMBER_ROLE_UNRECOGNISED, key: 'shell.error.destinations' },
    { code: MEMBER_ROLE_UNAVAILABLE, key: 'shell.error.destinations' },
    { code: SIGN_OUT_FAILED, key: 'shell.error.signOut' },
  ])('renders $code as $key', ({ code, key }) => {
    expect(navigationMessageKey(code)).toBe(key);
  });

  it.each(['shell.error.destinations', 'shell.error.signOut'])(
    'resolves %s against hr.json rather than to a placeholder',
    (key) => {
      // A key this mapping can return but the resource file does not declare
      // renders `⟦shell.error.…⟧` on screen. `pnpm typecheck` catches it too;
      // this is the half that survives a widened return type.
      expect(typeof messageAt(key)).toBe('string');
    },
  );
});

describe('the collapse and the split are both deliberate', () => {
  it('gives the three role failures one message, since they are one thing to do next', () => {
    // A refusal, an unrecognised level and a service failure differ in what went
    // wrong and not in what the person can do — and naming the difference would
    // mean writing `'supervisor'` onto a screen. The value is logged instead.
    const codes: MemberRoleFailure[] = [
      MEMBER_ROLE_REFUSED,
      MEMBER_ROLE_UNRECOGNISED,
      MEMBER_ROLE_UNAVAILABLE,
    ];
    const keys = codes.map((code) => navigationMessageKey(code));

    expect(new Set(keys).size, 'the three role failures render more than one message').toBe(1);
  });

  it('keeps the sign-out failure separate, because it is a different action', () => {
    // THE assertion of this file. Folded into the navigation message, a refused
    // press would report itself as a navigation problem — and leave somebody on
    // a shared device believing they had signed out when they had not.
    expect(navigationMessageKey(SIGN_OUT_FAILED)).not.toBe(
      navigationMessageKey(MEMBER_ROLE_UNAVAILABLE),
    );
  });

  it('is not a constant, and not its own argument', () => {
    // Vacuous-pass guard. A mapping returning one key for everything fails the
    // split above; a mapping returning its ARGUMENT would satisfy both rows if
    // the keys were ever renamed to match the codes, so the shape is pinned too.
    expect(navigationMessageKey(SIGN_OUT_FAILED)).not.toBe(SIGN_OUT_FAILED);
    expect(navigationMessageKey(MEMBER_ROLE_REFUSED)).not.toBe(MEMBER_ROLE_REFUSED);
  });
});
