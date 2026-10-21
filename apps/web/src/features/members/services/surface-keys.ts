import type { QueryKey } from '@tanstack/react-query';

import { MEMBERS_LIST_KEY } from '@/features/members/services/list';

/**
 * The admin's *Ljudi* table's reads as one snapshot (story 8.2b): the keys
 * its offline freshness is decided over — the member list alone, the one read
 * every figure on the table comes from (AD-13). `surface-keys.test.ts` pins
 * it and that it is kept on the device. The members' directory on the same
 * path is the teams feature's (`directorySurfaceKeysOf`).
 */
export const MEMBERS_TABLE_SURFACE_KEYS: readonly QueryKey[] = [MEMBERS_LIST_KEY];
