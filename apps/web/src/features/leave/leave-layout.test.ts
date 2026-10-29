import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { organizationLeaveRequestsReadOptions } from '@/features/leave/hooks/use-organization-leave-requests';
import { ORGANIZATION_LEAVE_REQUESTS_KEY } from '@/features/leave/services/leave-request-list';

/**
 * Retro 8–9 (D6), on the calendar snapshot's terms (`calendar-layout.test.ts`):
 * the organization's leave requests are read through ONE BINDING, so every
 * screen that reads them shares the key by construction.
 */

const srcRoot = fileURLToPath(new URL('../..', import.meta.url));
const source = (name: string): string =>
  readFileSync(join(srcRoot, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe("the organization's leave requests have one binding (retro 8–9)", () => {
  /** Every non-test module under `src`, as its path from `src` and its source without comments. */
  const modules = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => ({ name, text: source(name) }));

  it('calls `organizationLeaveRequestsQueryOptions(` nowhere but its definition and the one binding', () => {
    const callers = modules
      .filter(({ text }) => text.includes('organizationLeaveRequestsQueryOptions('))
      .map(({ name }) => name)
      .sort();

    expect(callers).toEqual([
      join('features', 'leave', 'hooks', 'use-organization-leave-requests.ts'),
      join('features', 'leave', 'services', 'leave-request-list.ts'),
    ]);
  });

  it('reads `readOrganizationLeaveRequestRows(` and declares its key in the list service alone', () => {
    const readers = modules.filter(({ text }) => text.includes('readOrganizationLeaveRequestRows(')).map(({ name }) => name);
    const keyed = modules
      .filter(({ text }) => /queryKey:\s*ORGANIZATION_LEAVE_REQUESTS_KEY\b/.test(text))
      .map(({ name }) => name);
    const list = join('features', 'leave', 'services', 'leave-request-list.ts');

    expect(readers).toEqual([list]);
    expect(keyed).toEqual([list]);
  });

  it('binds the read under the organization requests key, building its options without a request', () => {
    // The client is touched only inside `queryFn`, which this never calls.
    expect(organizationLeaveRequestsReadOptions().queryKey).toEqual(ORGANIZATION_LEAVE_REQUESTS_KEY);
  });

  it('is what Danas, Za odluku, a conflict\'s resolution and the member page\'s deactivation read through', () => {
    const observers = modules
      .filter(({ text }) => /\b(useOrganizationLeaveRequests|organizationLeaveRequestsReadOptions)\(\)/.test(text))
      .map(({ name }) => name)
      .filter((name) => name !== join('features', 'leave', 'hooks', 'use-organization-leave-requests.ts'))
      .sort();

    expect(observers).toEqual([
      join('features', 'conflicts', 'hooks', 'use-conflict-resolution.ts'),
      join('features', 'conflicts', 'hooks', 'use-conflicts-queue.ts'),
      join('features', 'members', 'hooks', 'use-member-status.ts'),
      join('features', 'today', 'hooks', 'use-admin-today.ts'),
    ]);
  });
});
