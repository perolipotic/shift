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
import { CredentialLine } from '@/features/members/components/credential-line';
import type { MemberCreate } from '@/features/members/hooks/use-member-create';
import { NO_TEXT, memberLevelMessageKey } from '@/features/members/services/list';
import {
  DEFAULT_MEMBER_ROLE,
  LEAVE_ALLOWANCE_MAX,
  type IssuedCredential,
} from '@/features/members/services/write';
import {
  RANK_OPTIONS,
  rankInitialValue,
  rankMessageKey,
  rankValue,
} from '@/features/members/utils/rank';
import { refusalText } from '@/features/members/utils/refusal-text';
import { MEMBER_ROLES } from '@/features/navigation/services/role';

/** `0002:145` — the column is `smallint not null check (>= 0)`, so the control
 *  cannot express a negative, a fraction of a day, or a number the column
 *  cannot hold. The ceiling is `LEAVE_ALLOWANCE_MAX`: above it the database
 *  answers `22003`, a refusal about a storage type that names nothing an admin
 *  can act on, and AD-3 prefers a shape that cannot express the broken case. */
const ALLOWANCE_MINIMUM = 0;
const ALLOWANCE_STEP = 1;
/** What a fresh form proposes. Not a policy — `members` carries no
 *  organization-wide constant (`0002:145`) — just the number an admin is most
 *  likely to keep, which they can change on every row. */
const ALLOWANCE_DEFAULT = 20;

/**
 * The create form's card: the refusal, then the form or the credential it
 * issued.
 *
 * THE READ IS GATED IN FULL, the way `organizacija.tsx:697-707` gates its own:
 * a skeleton while the organization read is pending, NO FORM once it has settled
 * failed, and the message rendered outside that branch so it is not hidden
 * behind the thing that failed. A form whose Save returns silently because the
 * organization id never arrived is the blank-page defect `pages/index.tsx:11-14`
 * warns about wearing a different shape — fully usable, completely inert.
 */
export function MemberCreateCard({ create }: { readonly create: MemberCreate }): ReactNode {
  const {
    nameField,
    usernameField,
    emailField,
    leaveField,
    roleField,
    rankField,
    pending,
    invalidField,
    credential,
    form,
    offersRank,
    refusal,
    submit,
  } = create;

  /**
   * The credential, shown once.
   *
   * A FUNCTION rather than a conditional inside the returned JSX, for the reason
   * `organizacija.tsx`'s `renderSettings` is one: `eslint.config.js`'s L2 block
   * refuses a string literal inside a branch nested in a branch that is an
   * element's own child, which a conditional `aria-describedby` inside a
   * conditionally rendered form is.
   */
  function renderCredential(issued: IssuedCredential): ReactNode {
    return (
      <div className="grid gap-4">
        <Notice role="status">
          {t('ljudi.form.created')}
        </Notice>
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{t('ljudi.form.username')}</p>
          {/* DATA, never a key — the username is what the admin typed, read
              back from the reply so what is shown is what the database holds. */}
          <p className="break-all font-mono text-base">{issued.username}</p>
        </div>
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{t('ljudi.form.credential')}</p>
          <CredentialLine password={issued.password} />
        </div>
        <p className="text-sm font-medium">{t('ljudi.form.credentialOnce')}</p>
      </div>
    );
  }

  /**
   * The rank control, offered only while the organization uses ranks.
   *
   * A FUNCTION for the reason `renderCredential` is one: a conditional
   * `aria-describedby` inside a conditionally rendered block is the shape
   * `eslint.config.js`'s L2 block refuses inline.
   */
  function renderRank(): ReactNode {
    return (
      <div className="grid gap-2">
        <Label htmlFor="member-rank">{t('ljudi.rank.label')}</Label>
        {/* A native `<select>` over the fixed list, no rank first. */}
        <InputGroup>
          <InputGroupIcon>
            <Medal />
          </InputGroupIcon>
          <Select
            ref={rankField}
            id="member-rank"
            name="fireRank"
            defaultValue={rankInitialValue(null)}
            aria-describedby={refusal === null ? undefined : 'member-form-error'}
            className="h-11"
          >
            {RANK_OPTIONS.map((option) => (
              <option key={rankValue(option)} value={rankValue(option)}>
                {t(rankMessageKey(option))}
              </option>
            ))}
          </Select>
        </InputGroup>
      </div>
    );
  }

  /**
   * The form, a skeleton, or nothing at all.
   *
   * NOTHING AT ALL is the case a naive version gets wrong: gated on
   * `organizationId === null` alone this returned a skeleton for a read that had
   * already FAILED, so an indefinitely pulsing bar was what a refused read
   * looked like — identical to a slow one, with the message that explains it
   * rendered by nothing. `createFormStateOf` separates pending from settled, and
   * the alert lives outside this function.
   */
  function renderForm(): ReactNode {
    if (form.organizationId === null) {
      return form.loading ? (
        <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
      ) : null;
    }

    return (
      <form
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-6"
      >
        <h2 className="text-base font-bold">{t('ljudi.form.sectionBasics')}</h2>
        <div className="grid gap-2">
          <Label htmlFor="member-name">{t('ljudi.name')}</Label>
          {/* UNCONTROLLED, with a `defaultValue` and never a `value`: a refused
              save must keep every entered value (UX-DR34), and a controlled
              field re-rendered from state on a refusal is how six of them get
              discarded at once. */}
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
              defaultValue={NO_TEXT}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-username">{t('ljudi.form.username')}</Label>
          {/* The credential AD-12 issues, and the local part of the address the
              account authenticates against. `autoCapitalize`/`autoCorrect` off
              for the reason the sign-in field turns them off: a phone keyboard
              capitalizing the first letter produces a username `0007`'s
              lowercase check refuses. */}
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
              defaultValue={NO_TEXT}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-email">{t('ljudi.email')}</Label>
          {/* OPTIONAL, and that is CAP-1 rather than an oversight: a member with
              no address is still a member (`0002:135`), which is the whole
              reason sign-in is a username. No `required` here and no fallback —
              an empty field stores `null`, never an empty string. */}
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
              defaultValue={NO_TEXT}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <h2 className="border-t pt-6 text-base font-bold">{t('ljudi.form.sectionSettings')}</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="member-role">{t('ljudi.role')}</Label>
            {/* The `Select` primitive, native underneath, as the accent control
                on `/organizacija` is: the native element carries keyboard
                behaviour, an accessible name through its `<Label>` and a phone's
                own picker sheet. Its options are the levels `0002:140`'s check
                constraint admits, read off `MEMBER_ROLES` rather than written
                here, so a third level appears the moment it exists. */}
            <InputGroup>
              <InputGroupIcon>
                <ShieldCheck />
              </InputGroupIcon>
              <Select
                ref={roleField}
                id="member-role"
                name="role"
                defaultValue={DEFAULT_MEMBER_ROLE}
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
          {offersRank ? renderRank() : null}
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
              defaultValue={ALLOWANCE_DEFAULT}
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
          {/* `type="reset"`, which on an uncontrolled form is exactly what
              cancelling means: every field goes back to its `defaultValue`. It
              is NOT the way out of this screen — that is the link on the page,
              because this route is not a destination and resetting a form
              leaves somebody exactly where they were. */}
          <Button className="h-11 w-full" type="reset" variant="outline" disabled={pending}>
            {t('ljudi.form.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Card className="w-full min-w-0 max-w-2xl">
      {/* OUTSIDE the gated branch, which is the whole point: a read that
          produced no organization renders no form, so an explanation rendered
          inside one would be exactly the element nobody can see. */}
      <CardContent className="grid gap-6">
        {refusal === null ? null : (
          <Notice id="member-form-error" role="alert">
            {refusalText(refusal)}
          </Notice>
        )}
        {credential === null ? renderForm() : renderCredential(credential)}
      </CardContent>
    </Card>
  );
}
