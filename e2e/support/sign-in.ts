import { expect, type Page } from '@playwright/test';

import { hr } from './i18n.ts';

/** The real two-step sign-in: organization, then username and password,
 *  through GoTrue. Leaves the page wherever the attempt lands. */
export async function submitSignIn(
  page: Page,
  slug: string,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/prijava');
  await page.getByLabel(hr.auth.organization.label, { exact: true }).fill(slug);
  await page.getByRole('button', { name: hr.auth.organization.submit }).click();
  await expect(page).toHaveURL(`/prijava/${slug}`);

  await page.getByLabel(hr.auth.username, { exact: true }).fill(username);
  await page.getByLabel(hr.auth.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: hr.auth.submit }).click();
}

/** Signs in and waits for the landing destination. */
export async function signIn(page: Page, slug: string, username: string, password: string) {
  await submitSignIn(page, slug, username, password);
  await expect(page).toHaveURL('/danas');
  await expect(page.getByRole('heading', { level: 1, name: hr.nav.danas })).toBeVisible();
}

/** The navigation landmark. Only one of the two (sidebar, phone bar) is ever
 *  rendered visible, so the name resolves to exactly one. */
export function navigation(page: Page) {
  return page.getByRole('navigation', { name: hr.shell.navigation });
}
