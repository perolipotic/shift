import { formatNumber } from '@/lib/i18n/format';
import { t } from '@/lib/i18n';
import {
  DAYS_CELL,
  LEVEL_CELL,
  NAME_CELL,
  STATUS_CELL,
  TEAM_CELL,
  TEXT_CELL,
  memberLevelMessageKey,
  memberStatusArgsOf,
  memberStatusMessageKey,
  type MemberCell,
} from '@/features/members/services/list';

/**
 * What one cell of the member list shows, from the value its COLUMN produced.
 *
 * IT TAKES A CELL, NOT A MEMBER, and that is the whole point of the refactor
 * this replaces. The previous version, in the screen, read `member.name`,
 * `member.email` and `member.leaveAllowanceDays` itself, and swapping two of
 * its branches rendered every address under `Ime` with the entire suite green.
 * `prijava.test.ts` pins every value this returns. The column now says what its cell HOLDS
 * (`@/features/members/services/list`, pinned there beside `sortValue`), and this function only
 * knows how to render each kind.
 *
 * EXHAUSTIVE, with `never` at the end: a fifth kind is a `pnpm typecheck`
 * failure here until it is told what to draw. `t()` and the number formatter
 * live on this side because a data module calling them would need i18next
 * initialised to be testable at all.
 */
export function cellContent(cell: MemberCell): string {
  if (cell.kind === TEXT_CELL || cell.kind === NAME_CELL) return cell.text;
  // STORY 7.13: today's status, or the change scheduled after it, in words.
  if (cell.kind === STATUS_CELL) return t(memberStatusMessageKey(cell), memberStatusArgsOf(cell));
  if (cell.kind === LEVEL_CELL) return t(memberLevelMessageKey(cell.level));
  // STORY 1.7b: the team today, and "no team" in positive words — never a
  // blank cell, which would read as a value that did not load.
  if (cell.kind === TEAM_CELL) return cell.team ?? t('smjene.membership.none');
  // `fractionDigits: 0` — an allowance is a whole number of days, and `20,00`
  // in a column of them is the wobble UX-DR40's tabular numerals prevent.
  if (cell.kind === DAYS_CELL) return formatNumber(cell.days, 0);

  const unhandled: never = cell;

  return unhandled;
}

/**
 * The unit a figure cell's value is read in on a phone's stacked row (story
 * 7.6), where no column heading stands above it: `dana god.` beside an
 * allowance, in the count's plural. `null` for a cell that is not a figure.
 * Decorative beside the row's `dt`, which carries the column's own label.
 */
export function cellUnit(cell: MemberCell): string | null {
  return cell.kind === DAYS_CELL ? t('ljudi.leaveUnit', { count: cell.days }) : null;
}
