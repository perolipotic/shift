import { AtSign, Mail, Medal, ShieldCheck, User } from 'lucide-react';
import { Fragment, type ReactNode, type SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import { NO_TEXT, memberLevelMessageKey, type MemberListRow } from '@/features/members/services/list';
import {
  MEMBER_BASICS_DIALOG_HEADING_ID,
  MEMBER_BASICS_HEADING_ID,
  MEMBER_FORM_ERROR_ID,
} from '@/features/members/utils/element-ids';
import {
  rankInitialValue,
  rankMessageKey,
  rankOptionsFor,
  rankValue,
} from '@/features/members/utils/rank';
import { refusalText } from '@/features/members/utils/refusal-text';
import { MEMBER_ROLES } from '@/features/navigation/services/role';

/** One fact: its label above its value, so nothing breaks on a phone. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * The member page's *Osnovni podaci* card (story 7.11): the facts — the
 * username, the address, the role and, while ranks are used, the rank — and
 * `Uredi` in its header, which opens {@link MemberBasicsDialog}. No field is
 * mounted on the page. The name is the page's title, so it is not repeated.
 *
 * THE READ'S OWN REFUSAL — the list refused, or the id reaches nobody — is
 * said here, because this card is always drawn; and so is the notice a
 * landed save leaves once its dialog has closed.
 */
export function MemberBasicsCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, offersRank, readRefusal, refusal, confirmed, pending, basicsDialog, allowanceDialog } = edit;
  /**
   * A PARTIAL SAVE once its dialog has closed: the other fields landed and the
   * rename did not, and the card keeps saying both.
   */
  const partial =
    basicsDialog.opening === null && allowanceDialog.opening === null && refusal !== null && refusal.saved
      ? refusal
      : null;

  function renderFacts(member: MemberListRow): ReactNode {
    return (
      <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Fact label={t('ljudi.form.username')}>{member.username}</Fact>
        <Fact label={t('ljudi.email')}>{member.email ?? t('ljudi.basics.noEmail')}</Fact>
        <Fact label={t('ljudi.role')}>{t(memberLevelMessageKey(member.role))}</Fact>
        {offersRank ? <Fact label={t('ljudi.rank.label')}>{t(rankMessageKey(member.fireRank))}</Fact> : null}
      </dl>
    );
  }

  /**
   * The facts, a skeleton, or nothing at all. NOTHING ONCE THE READ HAS
   * SETTLED FAILED, and nothing when the id reaches nobody: no dialog can be
   * opened on a record seeded from nothing.
   */
  function renderBody(): ReactNode {
    if (form.member !== null) return renderFacts(form.member);

    return form.loading ? (
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
    ) : null;
  }

  return (
    <>
      <Card role="region" aria-labelledby={MEMBER_BASICS_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={MEMBER_BASICS_HEADING_ID} tabIndex={-1}>
              {t('ljudi.basics.heading')}
            </h2>
          </CardTitle>
          {form.member === null ? null : (
            <Button
              ref={basicsDialog.opener}
              className="h-11"
              type="button"
              variant="outline"
              aria-label={t('ljudi.basics.editName', { name: form.member.name })}
              disabled={pending}
              onClick={basicsDialog.open}
            >
              {t('ljudi.basics.edit')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* OUTSIDE the gated branch: a read that produced no row renders no
              facts, so an explanation rendered inside them would be exactly
              the element nobody can see. */}
          {readRefusal === null ? null : <Notice role="alert">{refusalText(readRefusal)}</Notice>}
          {partial === null ? null : <Notice role="alert">{refusalText(partial)}</Notice>}
          {/* A LANDED SAVE, said on the card its dialog closed back onto.
              `role="status"`: the assertive region belongs to a refusal. */}
          {confirmed ? (
            <Notice role="status">
              {t('ljudi.form.saved')}
            </Notice>
          ) : null}
          {renderBody()}
        </CardContent>
      </Card>
      <MemberBasicsDialog edit={edit} />
    </>
  );
}

/**
 * `Uredi osnovne podatke` (story 7.11): name, username, address, role and —
 * while the organization uses ranks — the rank, behind one Spremi. NEVER THE
 * ALLOWANCE: it has its own dialog on the leave card, and this save does not
 * send it. Not dismissible while its save is in flight; a refusal keeps it
 * open with what was entered, its alert above the buttons; a landed save
 * closes it.
 *
 * THE BODY IS KEYED TO THE OPENING, so each opening starts from the record as
 * it is now, while a refetch during one leaves what is typed alone.
 */
export function MemberBasicsDialog({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const {
    nameField,
    usernameField,
    emailField,
    roleField,
    rankField,
    pending,
    form,
    refusal,
    offersRank,
    submit,
    basicsDialog,
  } = edit;
  const opening = basicsDialog.opening;

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
            aria-describedby={refusal === null ? undefined : MEMBER_FORM_ERROR_ID}
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

  /** The dialog's form. The way back to the list is never in here: it is the page's. */
  function renderForm(member: MemberListRow): ReactNode {
    return (
      <form
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-5"
      >
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
              aria-describedby={refusal === null ? undefined : MEMBER_FORM_ERROR_ID}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-username">{t('ljudi.form.username')}</Label>
          {/* THE ONE FIELD THAT CAN REACH THE PRIVILEGED BOUNDARY. Changing it
              moves `auth.users.email` as well as `members.username` —
              `saveMember` decides that, not this element. */}
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
              aria-describedby={refusal === null ? undefined : MEMBER_FORM_ERROR_ID}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-email">{t('ljudi.email')}</Label>
          {/* OPTIONAL (CAP-1, `0002:135`): an emptied field stores `null`. */}
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
              aria-describedby={refusal === null ? undefined : MEMBER_FORM_ERROR_ID}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="member-role">{t('ljudi.role')}</Label>
            {/* Demoting the last administrator is refused by `0002`'s deferred
                trigger AT COMMIT, and said here, in the dialog. */}
            <InputGroup>
              <InputGroupIcon>
                <ShieldCheck />
              </InputGroupIcon>
              <Select
                ref={roleField}
                id="member-role"
                name="role"
                defaultValue={member.role}
                aria-describedby={refusal === null ? undefined : MEMBER_FORM_ERROR_ID}
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
        {refusal === null ? null : (
          <Notice id={MEMBER_FORM_ERROR_ID} role="alert">
            {refusalText(refusal)}
          </Notice>
        )}
        <DialogFooter>
          <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={basicsDialog.close}>
            {t('ljudi.form.cancel')}
          </Button>
          <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
            {t('ljudi.form.save')}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <Dialog
      open={opening !== null && form.member !== null}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) basicsDialog.close();
      }}
      // ESCAPE closes through the screen's state, never while a save is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) basicsDialog.close();
      }}
      aria-labelledby={MEMBER_BASICS_DIALOG_HEADING_ID}
    >
      {opening === null || form.member === null ? null : (
        <>
          <DialogHeader closeLabel={t('ljudi.page.close')} onClose={basicsDialog.close}>
            <DialogTitle id={MEMBER_BASICS_DIALOG_HEADING_ID}>{t('ljudi.basics.dialogHeading')}</DialogTitle>
            <DialogDescription>{form.member.name}</DialogDescription>
          </DialogHeader>
          <Fragment key={opening.key}>{renderForm(form.member)}</Fragment>
        </>
      )}
    </Dialog>
  );
}
