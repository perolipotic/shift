import type { QueryKey } from '@tanstack/react-query';

import { ROTATION_KEY, type RotationSnapshot } from '@/features/rotation/services/list';
import { SHIFT_TYPES_LIST_KEY, type ShiftTypesSnapshot } from '@/features/shift-types/services/list';

/**
 * *Postavke rotacije* `/postavke-rotacije` and its shift type editor
 * `/postavke-rotacije/tipovi-smjena/$id` as one snapshot (story 8.2d): the
 * shift types and the rotation builder's own snapshot. The shift type hooks
 * and `useRotationBuilder` all decide over this one set, each observing its
 * own read and deciding the other's from the cache, so the page is drawn
 * whole under one note or is unavailable as one — and no screen gains a
 * second `useQuery`. `surface-keys.test.ts` pins the set and that every key
 * is kept on the device.
 */
export const ROTATION_SURFACE_KEYS: readonly QueryKey[] = [SHIFT_TYPES_LIST_KEY, ROTATION_KEY];

/**
 * The zone *Postavke rotacije*'s as-of note states its time in (story 8.2d):
 * the organization's, which either snapshot embeds — the shift types' first,
 * then the rotation's. With neither, `null`, and the page is unavailable
 * offline rather than drawn without its note.
 */
export function rotationSurfaceTimeZoneOf(
  shiftTypes: Pick<ShiftTypesSnapshot, 'timeZone'> | undefined,
  rotation: Pick<RotationSnapshot, 'timeZone'> | undefined,
): string | null {
  return shiftTypes?.timeZone ?? rotation?.timeZone ?? null;
}
