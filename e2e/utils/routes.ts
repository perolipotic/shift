import type { Page } from '@playwright/test';

/** The organization's leave read (`leave_records`) and its leave request read (`leave_requests`, story 9.5). */
export const ORGANIZATION_LEAVE_READS = ['**/rest/v1/leave_records*', '**/rest/v1/leave_requests*'] as const;

/**
 * Answers the organization's leave and leave request reads with the rows of
 * `memberIds` alone, with a matching exact count. Other specs write both to
 * the same run organization, and Za odluku, *Treba tebe* and the coverage
 * count every row of them, so a spec that asserts a count narrows them to its
 * own members first. Writes, and an answer that is not a list (an error), pass
 * through unchanged.
 */
export async function onlyRowsOf(page: Page, memberIds: string | Iterable<string>): Promise<void> {
  const ours = new Set(typeof memberIds === 'string' ? [memberIds] : memberIds);

  for (const table of ORGANIZATION_LEAVE_READS) {
    await page.route(table, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const answered = await route.fetch();
      const rows = (await answered.json().catch(() => null)) as unknown;
      if (!answered.ok() || !Array.isArray(rows)) return route.fulfill({ response: answered });
      const own = (rows as { readonly member_id?: string }[]).filter(
        (row) => row.member_id !== undefined && ours.has(row.member_id),
      );

      return route.fulfill({
        response: answered,
        headers: {
          ...answered.headers(),
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'Content-Range',
          'content-range': own.length === 0 ? '*/0' : `0-${String(own.length - 1)}/${String(own.length)}`,
        },
        body: JSON.stringify(own),
      });
    });
  }
}
