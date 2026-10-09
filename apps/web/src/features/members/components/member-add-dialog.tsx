import { Link } from '@tanstack/react-router';
import { AtSign, CalendarDays, Mail, Medal, Plus, ShieldCheck, User } from 'lucide-react';
import type { ReactNode, SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  MEMBER_ADD_CREATED_ID,
  MEMBER_ADD_DIALOG_HEADING_ID,
  MEMBER_ADD_ERROR_ID,
  MEMBER_ADD_USERNAME_HINT_AND_ERROR,
  MEMBER_ADD_USERNAME_HINT_ID,
} from '@/features/members/utils/element-ids';
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
 * *Dodaj osobu* (story 7.13b): a dialog on Ljudi, in two steps. The first is
 * the form — name, a username suggested from it, an optional address, level,
 * rank (while the organization uses ranks) and leave days. No team: that is
 * set on the member page. The second is the account it issued: the password
 * once, `Kopiraj`, and what comes next — *Dodaj još jednu* or *Otvori
 * stranicu osobe*.
 *
 * THE READ IS GATED IN FULL: a skeleton while the organization read is
 * pending, NO FORM once it has settled failed, and the message rendered outside
 * that branch so it is not hidden behind the thing that failed.
 *
 * NOT DISMISSIBLE WHILE A CREATE IS IN FLIGHT: Escape, the backdrop, the close
 * control and Cancel all wait for the outcome, so the dialog that reports it —
 * a password nobody can recover — cannot close before it lands.
 */
export function MemberAddDialog({ create }: { readonly create: MemberCreate }): ReactNode {
  const {
    nameField,
    usernameField,
    emailField,
    leaveField,
    roleField,
    rankField,
    shown,
    formKey,
    pending,
    invalidField,
    credential,
    createdName,
    form,
    offersRank,
    refusal,
    submit,
    close,
    again,
    nameChanged,
    usernameChanged,
  } = create;

  /**
   * The second step: the account issued, shown once.
   *
   * A FUNCTION rather than a conditional inside the returned JSX: the L2 lint
   * block refuses a string literal inside a branch nested in a branch that is
   * an element's own child.
   */
  function renderCredential(issued: IssuedCredential): ReactNode {
    return (
      <div className="grid gap-5">
        {/* DATA in apposition, never declined: the name as entered and the
            username as the reply returned it. */}
        {/* FOCUSABLE BY SCRIPT ONLY: where focus lands once the form, and
            its focused submit, are replaced by this step. */}
        <Notice id={MEMBER_ADD_CREATED_ID} role="status" tabIndex={-1}>
          {t('ljudi.form.createdFor', { name: createdName, username: issued.username })}
        </Notice>
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{t('ljudi.form.credential')}</p>
          <CredentialLine password={issued.password} />
        </div>
        <p className="text-sm font-medium">{t('ljudi.form.credentialOnce')}</p>
        <p className="text-sm text-muted-foreground">{t('ljudi.form.noTeam')}</p>
        <DialogFooter>
          {/* A LINK, and only when the reply named the row: a blank id has no
              page to open, and the password above is shown regardless. It
              REPLACES the `?dodaj=1` entry, so Back from the member page
              returns to the list rather than to an empty first step. */}
          {issued.memberId === null ? null : (
            <Button asChild variant="outline" className="h-11">
              <Link to="/ljudi/$id" params={{ id: issued.memberId }} replace>
                {t('ljudi.form.openPage')}
              </Link>
            </Button>
          )}
          <Button className="h-11" type="button" onClick={again}>
            <Plus aria-hidden />
            {t('ljudi.form.again')}
          </Button>
        </DialogFooter>
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
            aria-describedby={refusal === null ? undefined : MEMBER_ADD_ERROR_ID}
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
   * The first step: the form, a skeleton, or nothing at all.
   *
   * NOTHING AT ALL is the case a naive version gets wrong: gated on
   * `organizationId === null` alone this returned a skeleton for a read that had
   * already FAILED, so an indefinitely pulsing bar was what a refused read
   * looked like. `createFormStateOf` separates pending from settled, and the
   * alert lives outside this function.
   */
  function renderForm(): ReactNode {
    if (form.organizationId === null) {
      return form.loading ? (
        <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
      ) : null;
    }

    return (
      // KEYED, so *Dodaj još jednu* and a close remount every field onto its
      // default; a refusal re-renders without a new key and keeps them.
      <form
        key={formKey}
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-5"
      >
        <div className="grid gap-2">
          <Label htmlFor="member-name">{t('ljudi.name')}</Label>
          {/* UNCONTROLLED, with a `defaultValue` and never a `value`: a refused
              save must keep every entered value (UX-DR34). */}
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
              onChange={nameChanged}
              aria-describedby={refusal === null ? undefined : MEMBER_ADD_ERROR_ID}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-username">{t('ljudi.form.username')}</Label>
          {/* SUGGESTED FROM THE NAME until the admin edits it. `autoCapitalize`
              and `autoCorrect` off: a phone keyboard capitalizing the first
              letter produces a username `0007`'s lowercase check refuses. */}
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
              onChange={usernameChanged}
              aria-describedby={refusal === null ? MEMBER_ADD_USERNAME_HINT_ID : MEMBER_ADD_USERNAME_HINT_AND_ERROR}
              className="h-11"
            />
          </InputGroup>
          <p id={MEMBER_ADD_USERNAME_HINT_ID} className="text-sm text-muted-foreground">
            {t('ljudi.form.usernameHint')}
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-email">{t('ljudi.email')}</Label>
          {/* OPTIONAL, and that is CAP-1 rather than an oversight: a member with
              no address is still a member (`0002:135`). An empty field stores
              `null`, never an empty string. */}
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
              aria-describedby={refusal === null ? undefined : MEMBER_ADD_ERROR_ID}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="member-role">{t('ljudi.role')}</Label>
            {/* The levels `0002:140`'s check admits, read off `MEMBER_ROLES`. */}
            <InputGroup>
              <InputGroupIcon>
                <ShieldCheck />
              </InputGroupIcon>
              <Select
                ref={roleField}
                id="member-role"
                name="role"
                defaultValue={DEFAULT_MEMBER_ROLE}
                aria-describedby={refusal === null ? undefined : MEMBER_ADD_ERROR_ID}
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
              aria-describedby={refusal === null ? undefined : MEMBER_ADD_ERROR_ID}
              className="h-11"
            />
          </InputGroup>
        </div>
        <DialogFooter>
          <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={close}>
            {t('ljudi.form.cancel')}
          </Button>
          <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
            {t('ljudi.form.add')}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <Dialog
      open={shown}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      // ESCAPE closes through the URL, never while a create is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) close();
      }}
      aria-labelledby={MEMBER_ADD_DIALOG_HEADING_ID}
    >
      <DialogHeader closeLabel={t('ljudi.page.close')} onClose={close}>
        <DialogTitle id={MEMBER_ADD_DIALOG_HEADING_ID} tabIndex={-1}>{t('ljudi.form.newHeading')}</DialogTitle>
        <DialogDescription>{t('ljudi.form.newLede')}</DialogDescription>
      </DialogHeader>
      {/* INSIDE the dialog and OUTSIDE the gated branch: a read that produced
          no organization renders no form, so an explanation rendered inside
          one would be exactly the element nobody can see. */}
      {refusal === null ? null : (
        <Notice id={MEMBER_ADD_ERROR_ID} role="alert">
          {refusalText(refusal)}
        </Notice>
      )}
      {credential === null ? renderForm() : renderCredential(credential)}
    </Dialog>
  );
}
