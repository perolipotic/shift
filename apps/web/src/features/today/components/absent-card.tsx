import { Link } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { ModifierGlyphs } from '@/features/calendar/components/modifier-glyphs';
import { MODIFIER_LEAVE, glyphOf } from '@/features/calendar/utils/modifiers';
import {
  absentLineMessageKey,
  absentTomorrowMessageKey,
  type Absences,
  type AbsentMember,
} from '@/features/today/services/admin-today';
import { t } from '@/lib/i18n';

/** The leave mark's glyph, as the calendar draws it. */
const LEAVE_GLYPHS = [glyphOf(MODIFIER_LEAVE)];

/** One member on leave today: the name, then the team and the whole absence. */
function renderToday(member: AbsentMember): ReactNode {
  return (
    <li key={member.memberId} className="flex min-w-0 items-center gap-3 py-1">
      <span aria-hidden className="shrink-0 text-sm">
        <ModifierGlyphs glyphs={LEAVE_GLYPHS} />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="min-w-0 break-words font-semibold">{member.name}</span>
        <span className="min-w-0 break-words text-sm text-muted-foreground tabular-nums">
          {t(absentLineMessageKey(member), { team: member.teamName, from: member.from, to: member.to, date: member.from })}
        </span>
      </span>
    </li>
  );
}

/**
 * *Odsutni danas* (story 6.3): every active member whose leave covers today,
 * or the sentence that says nobody is; then each one whose leave starts
 * tomorrow; and the way to *Godišnji*.
 */
export function AbsentCard({ absences }: { readonly absences: Absences }): ReactNode {
  const headingId = useId();

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="grid min-w-0 gap-2 p-4 sm:p-6">
        <h2 id={headingId} className="font-heading text-lg font-semibold">
          {t('danas.admin.absent.heading')}
        </h2>
        {absences.today.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('danas.admin.absent.none')}</p>
        ) : (
          <ul className="grid min-w-0 gap-1">{absences.today.map(renderToday)}</ul>
        )}
        {absences.tomorrow.map((member) => (
          <p key={member.memberId} className="min-w-0 break-words text-sm text-muted-foreground tabular-nums">
            {t(absentTomorrowMessageKey(member), {
              name: member.name,
              team: member.teamName,
              from: member.from,
              to: member.to,
              date: member.from,
            })}
          </p>
        ))}
        <Link to="/godisnji" className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">
          {t('danas.admin.absent.link')}
        </Link>
      </section>
    </Card>
  );
}
