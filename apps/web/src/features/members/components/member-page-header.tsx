import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import { MEMBER_PAGE_HEADING_ID } from '@/features/members/utils/element-ids';
import { memberHeaderFactsOf, type MemberHeaderFacts } from '@/features/members/utils/member-facts';
import { initialsOf } from '@/utils/initials';

/**
 * The member page's title (story 7.11): WHO THE PERSON IS, not what the page
 * does. The `h1` is the name; under it the rank, the position and the team,
 * each only where it is used; then the role and today's status as badges
 * whose words are their meaning. Until the member is read — or when the id
 * reaches nobody — the `h1` is a neutral "Osoba", so the page always has one.
 */
export function MemberPageTitle({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, today, offersRank } = edit;
  const member = form.member;

  /** The subline — rank, position and team, each only where used — and the two badges. */
  function renderFacts(facts: MemberHeaderFacts): ReactNode {
    const parts = [
      facts.rank === null ? null : t(facts.rank),
      facts.position === null ? null : t(facts.position),
      facts.team ?? t('smjene.membership.none'),
    ].filter((part): part is string => part !== null);

    return (
      <>
        <p className="text-sm text-muted-foreground">{parts.join(t('ljudi.page.separator'))}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={facts.roleBadge}>{t(facts.role)}</Badge>
          <Badge variant="outline">{t(facts.status)}</Badge>
        </div>
      </>
    );
  }

  if (member === null) {
    return (
      <PageTitle asChild>
        <h1 id={MEMBER_PAGE_HEADING_ID} tabIndex={-1}>
          {t('ljudi.page.heading')}
        </h1>
      </PageTitle>
    );
  }

  // THE NAME AS SOON AS THE MEMBER IS READ; the facts that need the
  // organization's today wait for it.
  const facts = today === null ? null : memberHeaderFactsOf(member, today, offersRank);
  const initials = initialsOf(member.name);

  return (
    <div className="flex min-w-0 items-start gap-3">
      <Avatar className="size-11 text-sm">{initials}</Avatar>
      <div className="grid min-w-0 gap-1.5">
        <PageTitle asChild>
          <h1 id={MEMBER_PAGE_HEADING_ID} tabIndex={-1}>
            {member.name}
          </h1>
        </PageTitle>
        {facts === null ? null : renderFacts(facts)}
      </div>
    </div>
  );
}
