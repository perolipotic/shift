import { Link } from '@tanstack/react-router';
import { Eye, Pencil, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { StackedField, StackedFields, StackedList, StackedRow } from '@/components/ui/stacked-list';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePhone } from '@/hooks/viewport';
import { teamActionMessageKey, type TeamRow } from '@/features/teams/services/list';
import { t } from '@/lib/i18n';

/**
 * A group as a table, or nothing at all when it has none: its count says so.
 * Below 640 px the same rows stack instead (story 7.6's pattern, UX-DR17),
 * named by the group's heading; only one of the two forms is in the DOM.
 */
export function TeamTable({
  group,
  label,
}: {
  readonly group: readonly TeamRow[];
  /** The group's heading, from the screen's `t()`: what names the phone's list. */
  readonly label: string;
}): ReactNode {
  const isPhone = usePhone();

  if (group.length === 0) return null;

  if (isPhone) {
    return (
      <StackedList aria-label={label} className="border-t">
        {group.map((team) => (
          <StackedRow key={team.id} className="flex items-center gap-3">
            <IconTile>
              <Users />
            </IconTile>
            <StackedFields className="flex-1">
              <StackedField label={t('smjene.name')} labelHidden>
                <span className="font-semibold">{team.name}</span>
              </StackedField>
            </StackedFields>
            {renderAction(team)}
          </StackedRow>
        ))}
      </StackedList>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('smjene.name')}</TableHead>
          <TableHead className="text-right">{t('smjene.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {group.map((team) => (
          <TableRow key={team.id}>
            <TableCell>
              <div className="flex min-w-0 items-center gap-3">
                <IconTile>
                  <Users />
                </IconTile>
                <span className="truncate font-semibold">{team.name}</span>
              </div>
            </TableCell>
            <TableCell className="text-right">{renderAction(team)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The row's 44 px link, in both forms. NAMED FOR THE TEAM IT OPENS; the name
 * is data, interpolated. An archived team's row VIEWS it —
 * `teamActionMessageKey` decides, because its dialog offers no edit.
 */
function renderAction(team: TeamRow): ReactNode {
  return (
    <Button asChild variant="ghost" className="h-11 w-11 shrink-0 px-0">
      <Link to="/ljudi/smjene/$id" params={{ id: team.id }}>
        {team.archived ? <Eye aria-hidden /> : <Pencil aria-hidden />}
        <span className="sr-only">{t(teamActionMessageKey(team), { name: team.name })}</span>
      </Link>
    </Button>
  );
}
