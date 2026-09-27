import { randomBytes } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

import { hr } from './i18n.ts';

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

/**
 * Fills and submits the already open `/ljudi/novi` form — the admin-auth Edge
 * Function's `createUser` — and waits for the one-time password screen. The
 * address it builds is under this run's domain, so teardown reaches it.
 */
export async function submitNewMember(page: Page, name: string, username: string): Promise<void> {
  await page.getByLabel(hr.ljudi.name, { exact: true }).fill(name);
  await page.getByLabel(hr.ljudi.form.username, { exact: true }).fill(username);
  await page.getByRole('button', { name: hr.ljudi.form.save }).click();

  await expect(page.getByRole('status')).toHaveText(hr.ljudi.form.created);
}

/** Opens `/ljudi/novi` and issues the account. */
export async function createMember(page: Page, name: string, username: string): Promise<void> {
  await page.goto('/ljudi/novi');
  await submitNewMember(page, name, username);
}
