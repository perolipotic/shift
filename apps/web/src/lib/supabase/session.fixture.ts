import type { Session } from '@supabase/supabase-js';

/**
 * THE ONE TEST SESSION, written once rather than once per test file (six
 * copies had accreted, with two different user ids).
 *
 * Enough of a session to be distinguishable from `null` and to carry the one
 * field the reads use: `user.id`, which a read filters `auth_user_id` by.
 */
export const SESSION = {
  access_token: 'token',
  user: { id: 'auth-user-id' },
} as unknown as Session;
