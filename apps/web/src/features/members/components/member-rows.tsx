import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  StackedField,
  StackedFields,
  StackedList,
  StackedRow,
  StackedSkeletonRow,
} from '@/components/ui/stacked-list';
import { t } from '@/lib/i18n';
import { CellView } from '@/features/members/components/cell-view';
import type { MemberList } from '@/features/members/hooks/use-member-list';
import {
  LEAVE_COLUMN,
  LEVEL_COLUMN,
  NAME_COLUMN,
  TEAM_COLUMN,
  memberActionName,
  memberCellLookOf,
  memberColumnOf,
  type MemberListRow,
} from '@/features/members/services/list';
import { cellContent, cellUnit } from '@/features/members/utils/cell-content';

/** How many skeleton rows stand in for the list while it loads: the table's five. */
const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * The member list on a phone (story 7.6): the table's own columns as stacked
 * rows, every cell read from the same `MEMBER_COLUMNS` entry the table reads.
 * A row is the initials chip, the name as its title with `{team} · {level}`
 * under it, the leave allowance on the right, and a chevron. The address is
 * not shown on a phone (the approved mockup); it stays on the member page and
 * in the table from 640 px.
 *
 * ONE LINK PER ROW: the name's link to `/ljudi/$id` stretches over the whole
 * row (`after:absolute after:inset-0`) and carries the table's edit-link name,
 * `Uredi osobu {name}` from `memberActionName`, so there is no pencil.
 *
 * EVERY VALUE IS A `StackedField`, so each is announced with its column's own
 * heading, even where the position carries it (`labelHidden`).
 */
export function MemberRows({ list }: { readonly list: MemberList }): ReactNode {
  const { loading, narrowed, today } = list;

  return (
    <StackedList aria-label={t('ljudi.caption')} aria-busy={loading}>
      {/* TWO CONTAINERS rather than one ternary, as in the table: the bare-JSX
          sweep reads every run between a `>` and the next `<`. */}
      {loading ? SKELETON_ROWS.map((row) => <StackedSkeletonRow key={row} avatar />) : null}
      {loading ? null : narrowed.rows.map((member) => <MemberRow key={member.id} member={member} today={today} />)}
    </StackedList>
  );
}

/** One member as a stacked row. */
function MemberRow({
  member,
  today,
}: {
  readonly member: MemberListRow;
  readonly today: string | null;
}): ReactNode {
  const name = memberColumnOf(NAME_COLUMN);
  const team = memberColumnOf(TEAM_COLUMN);
  const level = memberColumnOf(LEVEL_COLUMN);
  const leave = memberColumnOf(LEAVE_COLUMN);
  const nameCell = name.cell(member, today);
  const look = memberCellLookOf(nameCell);
  const leaveCell = leave.cell(member, today);

  return (
    <StackedRow className="flex items-center gap-3">
      {/* The chip is decorative, and below 360 px its width is what lets a
          level's badge fit beside the team rather than under the figure. */}
      {look.avatar === null ? null : <Avatar className="max-[359px]:hidden">{look.avatar.initials}</Avatar>}
      <StackedFields className="flex min-w-0 flex-1 flex-wrap items-baseline text-sm text-muted-foreground">
        <StackedField label={t(name.label)} labelHidden className="basis-full">
          <span className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              to="/ljudi/$id"
              params={{ id: member.id }}
              aria-label={t('ljudi.form.edit', { name: memberActionName(member) })}
              className="inline-flex min-h-11 items-center font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
            >
              {cellContent(nameCell)}
            </Link>
            {look.status === null ? null : (
              <span>
                <span className="sr-only">{t('ljudi.status.separator')}</span>
                <Badge variant={look.status.variant}>{t(look.status.key, look.status.args)}</Badge>
              </span>
            )}
          </span>
        </StackedField>
        <StackedField label={t(team.label)} labelHidden>
          <CellView cell={team.cell(member, today)} />
        </StackedField>
        <StackedField label={t(level.label)} labelHidden separated>
          <CellView cell={level.cell(member, today)} />
        </StackedField>
      </StackedFields>
      <StackedFields className="shrink-0 text-right">
        <StackedField label={t(leave.label)} labelHidden>
          <span className="block font-semibold">{cellContent(leaveCell)}</span>
          <span aria-hidden className="block text-xs text-muted-foreground">
            {cellUnit(leaveCell)}
          </span>
        </StackedField>
      </StackedFields>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </StackedRow>
  );
}
