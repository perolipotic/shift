import { AtSign, CalendarDays, Mail, Medal, Save, ShieldCheck, User } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import { NO_TEXT, memberLevelMessageKey, type MemberListRow } from '@/features/members/services/list';
import { LEAVE_ALLOWANCE_MAX, memberFormKey } from '@/features/members/services/write';
import {
  rankInitialValue,
  rankMessageKey,
  rankOptionsFor,
  rankValue,
} from '@/features/members/utils/rank';
import { refusalText } from '@/features/members/utils/refusal-text';
import { MEMBER_ROLES } from '@/features/navigation/services/role';

/** `0002:145` — the column is `smallint not null check (>= 0)`, bounded above
 *  by what a `smallint` can hold: past that the database answers `22003`, a
 *  refusal about a storage type rather than about a value. */
const ALLOWANCE_MINIMUM = 0;
const ALLOWANCE_STEP = 1;

/**
 * The member edit screen's first card: the refusal, the confirmation that a
 * save landed, and the form, a skeleton, or nothing.
 *
 * THE FORM REMOUNTS WITH THE ROW. Every field is uncontrolled, so its
 * `defaultValue` seeds the DOM at MOUNT and never again — and the screen
 * refetches after every successful save. `key={memberFormKey(member)}` is what
 * keeps the fields, and `Odustani` (`type="reset"`), from snapping back to what
 * the row held when the screen opened.
 */
export function MemberBasicsCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const {
    nameField,
    usernameField,
    emailField,
    leaveField,
    roleField,
    rankField,
    pending,
    invalidField,
    form,
    refusal,
    confirmed,
    offersRank,
    submit,
  } = edit;

  /**
   * The form, a skeleton, or nothing at all.
   *
   * A FUNCTION rather than a conditional inside the returned JSX, for the reason
   * `organizacija.tsx`'s `renderSettings` is one: `eslint.config.js`'s L2 block
   * refuses a string literal inside a branch nested in a branch that is an
   * element's own child.
   *
   * NO FORM ONCE THE READ HAS SETTLED FAILED, and none when the id reaches
   * nobody: a form seeded from nothing saves its defaults over a person's
   * record, which is worse than no form at all.
   */
  function renderForm(member: MemberListRow): ReactNode {
    return (
      <form
        key={memberFormKey(member)}
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-6"
      >
        <h2 className="text-base font-bold">{t('ljudi.form.sectionBasics')}</h2>
        <div className="grid gap-2">
          <Label htmlFor="member-name">{t('ljudi.name')}</Label>
          <InputGroup>
            <InputGroupIcon>
              <User />
            </InputGroupIcon>
            <Input
              ref={nameField}
              id="member-name"
              name="name"
              type="text"
              required
              defaultValue={member.name}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-username">{t('ljudi.form.username')}</Label>
          {/* THE ONE FIELD THAT CAN REACH THE PRIVILEGED BOUNDARY. Changing it
              moves `auth.users.email` as well as `members.username`, which is
              the one thing row level security cannot do — `saveMember` decides
              that, not this element. */}
          <InputGroup>
            <InputGroupIcon>
              <AtSign />
            </InputGroupIcon>
            <Input
              ref={usernameField}
              id="member-username"
              name="username"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              required
              defaultValue={member.username}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-email">{t('ljudi.email')}</Label>
          {/* OPTIONAL (CAP-1, `0002:135`): a member with no address is still a
              member. An emptied field stores `null`, never an empty string. */}
          <InputGroup>
            <InputGroupIcon>
              <Mail />
            </InputGroupIcon>
            <Input
              ref={emailField}
              id="member-email"
              name="email"
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              defaultValue={member.email ?? NO_TEXT}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <h2 className="border-t pt-6 text-base font-bold">{t('ljudi.form.sectionSettings')}</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="member-role">{t('ljudi.role')}</Label>
            {/* Demoting the last administrator of an organization is refused by
                `0002:242-246`'s deferred trigger AT COMMIT, not here: the control
                can express it and the database is what says no, which is the same
                division every other refusal on this surface follows. */}
            <InputGroup>
              <InputGroupIcon>
                <ShieldCheck />
              </InputGroupIcon>
              <Select
                ref={roleField}
                id="member-role"
                name="role"
                defaultValue={member.role}
                aria-describedby={refusal === null ? undefined : 'member-form-error'}
                className="h-11"
              >
                {MEMBER_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {t(memberLevelMessageKey(option))}
                  </option>
                ))}
              </Select>
            </InputGroup>
          </div>
          {offersRank ? renderRank(member) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-leave">{t('ljudi.leave')}</Label>
          <InputGroup>
            <InputGroupIcon>
              <CalendarDays />
            </InputGroupIcon>
            <Input
              ref={leaveField}
              id="member-leave"
              name="leaveAllowanceDays"
              type="number"
              min={ALLOWANCE_MINIMUM}
              max={LEAVE_ALLOWANCE_MAX}
              step={ALLOWANCE_STEP}
              aria-invalid={invalidField === 'member-leave'}
              required
              defaultValue={member.leaveAllowanceDays}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2 border-t pt-6 sm:grid-cols-2">
          <Button className="h-11 w-full" type="submit" disabled={pending} aria-busy={pending}>
            <Save aria-hidden />
            {t('ljudi.form.save')}
          </Button>
          <Button className="h-11 w-full" type="reset" variant="outline" disabled={pending}>
            {t('ljudi.form.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  /**
   * The rank control, offered only while the organization uses ranks.
   *
   * Seeded from the row. A stored code this build lacks is offered as its own
   * "unknown rank" option, so the control describes the row honestly and a
   * save that does not touch it sends back what the row holds.
   */
  function renderRank(member: MemberListRow): ReactNode {
    return (
      <div className="grid gap-2">
        <Label htmlFor="member-rank">{t('ljudi.rank.label')}</Label>
        <InputGroup>
          <InputGroupIcon>
            <Medal />
          </InputGroupIcon>
          <Select
            ref={rankField}
            id="member-rank"
            name="fireRank"
            defaultValue={rankInitialValue(member.fireRank)}
            aria-describedby={refusal === null ? undefined : 'member-form-error'}
            className="h-11"
          >
            {rankOptionsFor(member.fireRank).map((option) => (
              <option key={rankValue(option)} value={rankValue(option)}>
                {t(rankMessageKey(option))}
              </option>
            ))}
          </Select>
        </InputGroup>
      </div>
    );
  }

  function renderBody(): ReactNode {
    if (form.member !== null) return renderForm(form.member);

    return form.loading ? (
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
    ) : null;
  }

  return (
    <Card className="w-full min-w-0 max-w-2xl">
      {/* OUTSIDE the gated branch: a read that produced no row renders no
          form, so an explanation rendered inside one would be exactly the
          element nobody can see. */}
      <CardContent className="grid gap-6">
        {refusal === null ? null : (
          <Notice id="member-form-error" role="alert">
            {refusalText(refusal)}
          </Notice>
        )}
        {/* THE ONLY THING THAT SAYS A SAVE LANDED. Every field is
            uncontrolled and remounts to the values it was just saved with, so
            without this a successful save leaves the screen looking exactly
            as it did before the press — indistinguishable from a click that
            did nothing. `role="status"` and not `role="alert"`: the assertive
            region belongs to the refusal, and a second one would be a second
            thing competing to be announced. */}
        {confirmed ? (
          <Notice role="status">
            {t('ljudi.form.saved')}
          </Notice>
        ) : null}
        {renderBody()}
      </CardContent>
    </Card>
  );
}
