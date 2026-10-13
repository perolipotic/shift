/**
 * THE RESOURCE-FILE FLATTENER, written once for every test that reads
 * `locales/hr.json` (three copies had accreted: `pages/prijava.test.ts`,
 * `features/navigation/utils/destinations.test.ts` and the root
 * `test/resource-hygiene.test.ts`).
 *
 * Pure and import-free, so the root tests can import it by relative path the
 * way they import the screen fixtures, with no alias to resolve. Each caller
 * reads the file itself and hands the parsed tree in.
 */

/** Every leaf key path in a resource tree, dotted the way i18next resolves. */
export function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];

  return Object.entries(node).flatMap(([key, value]) =>
    leafKeys(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/** Every message in a resource tree, however deeply nested. */
export function leafMessages(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (typeof node !== 'object' || node === null) return [];

  return Object.values(node).flatMap((value) => leafMessages(value));
}
