import type { Session } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { MEMBER_NAME_COLUMNS, readMemberName } from '@/navigation/profile';
import type { MemberTable, PostgrestAnswer } from '@/navigation/role';

const SESSION = { user: { id: 'auth-user-id' } } as unknown as Session;
const signedIn = (): Promise<Session | null> => Promise.resolve(SESSION);

function answering(answer: PostgrestAnswer | Error) {
  const asked: { columns: string[]; filters: string[][] } = { columns: [], filters: [] };
  const table: MemberTable = {
    select: (columns) => {
      asked.columns.push(columns);
      return {
        filter: (column, operator, value) => {
          asked.filters.push([column, operator, value]);
          return {
            limit: () =>
              answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
          };
        },
      };
    },
  };
  return { table, asked };
}

describe('readMemberName', () => {
  it("reads the signed-in person's own row, name only", async () => {
    const { table, asked } = answering({ data: [{ name: 'Ivan Marić' }], error: null });

    expect(await readMemberName(table, signedIn)).toBe('Ivan Marić');
    expect(asked.columns).toEqual([MEMBER_NAME_COLUMNS]);
    expect(asked.filters).toEqual([['auth_user_id', 'eq', 'auth-user-id']]);
  });

  it('answers null with no session', async () => {
    const { table } = answering({ data: [{ name: 'Ivan Marić' }], error: null });
    expect(await readMemberName(table, () => Promise.resolve(null))).toBeNull();
  });

  it.each([
    ['a refusal', { data: null, error: { code: '42501' } }],
    ['no row', { data: [], error: null }],
    ['a blank name', { data: [{ name: '  ' }], error: null }],
    ['a non-string name', { data: [{ name: 7 }], error: null }],
    ['a thrown read', new Error('network')],
  ] as const)('answers null for %s', async (_, answer) => {
    const { table } = answering(answer as PostgrestAnswer | Error);
    expect(await readMemberName(table, signedIn)).toBeNull();
  });
});
