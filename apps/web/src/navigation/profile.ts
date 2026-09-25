import type { Session } from '@supabase/supabase-js';

import type { MemberRole } from '@/navigation/destinations';
import type { MemberTable } from '@/navigation/role';

/**
 * The signed-in person's own name, for the profile card at the foot of the
 * sidebar (sidebar redesign).
 *
 * A SEPARATE READ from the role, deliberately. `readMemberRole` is what the
 * router's guards and the destination list stand on, and its column list is
 * pinned to `role` alone; widening it would make a name that fails to parse a
 * reason to refuse navigation. The name is decoration: the card falls back to
 * the role on its own, so this answers `null` for every failure and never
 * throws.
 */

export const MEMBER_NAME_KEY = ['member-name'] as const;
export const MEMBER_NAME_COLUMNS = 'name';

const AUTH_USER_COLUMN = 'auth_user_id';
const EQUALS = 'eq';

export async function readMemberName(
  table: MemberTable,
  session: () => Promise<Session | null>,
): Promise<string | null> {
  try {
    const current = await session();
    if (current === null) return null;

    const answered = await table
      .select(MEMBER_NAME_COLUMNS)
      .filter(AUTH_USER_COLUMN, EQUALS, current.user.id)
      .limit(1);

    const row: unknown = answered.error === null ? answered.data?.[0] : undefined;
    if (typeof row !== 'object' || row === null) return null;

    const name = (row as Record<string, unknown>)['name'];
    return typeof name === 'string' && name.trim() !== '' ? name : null;
  } catch {
    return null;
  }
}

/**
 * The words the profile card says under the name. The same two the member list
 * uses for the same fact, read from here so the chrome consumes a role without
 * branching on one (`prijava.test.ts` holds it to that).
 */
const ROLE_LABEL_KEYS: Record<MemberRole, 'ljudi.admin' | 'ljudi.member'> = {
  admin: 'ljudi.admin',
  member_role: 'ljudi.member',
};

export function memberRoleLabelKey(role: MemberRole): 'ljudi.admin' | 'ljudi.member' {
  return ROLE_LABEL_KEYS[role];
}
