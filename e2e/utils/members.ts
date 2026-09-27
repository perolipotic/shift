import { randomBytes } from 'node:crypto';

/** ASCII only: `Članica` → `clanica`. `đ` has no decomposition, so it is
 *  mapped by hand; anything else outside [a-z0-9] becomes a dot. */
function asciiUsernamePart(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

/** A member no other test, and no earlier attempt of this one, has touched. */
export function uniqueMember(label: string): { name: string; username: string } {
  const suffix = randomBytes(3).toString('hex');
  return { name: `${label} ${suffix}`, username: `e2e.${asciiUsernamePart(label)}.${suffix}` };
}
