import { Link } from '@tanstack/react-router';
import { Eye, Pencil, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { teamActionMessageKey, type TeamRow } from '@/features/teams/services/list';
import { t } from '@/lib/i18n';

/** A group as a table, or nothing at all when it has none: its count says so. */
export function TeamTable({ group }: { readonly group: readonly TeamRow[] }): ReactNode {
  if (group.length === 0) return null;

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
            <TableCell className="text-right">
              {/* NAMED FOR THE TEAM IT OPENS; the name is data, interpolated.
                  An archived team's row VIEWS it — `teamActionMessageKey`
                  decides, because its dialog offers no edit. */}
              <Button asChild variant="ghost" className="h-11 w-11 px-0">
                <Link to="/ljudi/smjene/$id" params={{ id: team.id }}>
                  {team.archived ? <Eye aria-hidden /> : <Pencil aria-hidden />}
                  <span className="sr-only">{t(teamActionMessageKey(team), { name: team.name })}</span>
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
