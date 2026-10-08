import { CalendarClock } from 'lucide-react';
import { Fragment, type ReactNode, type SyntheticEvent } from 'react';

import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';

import { Button } from '@/components/ui/button';
import { Callout, CalloutBody } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ConfirmDialog,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import { memberErasureCopyOf } from '@/features/members/utils/erasure-copy';
import { NO_TEXT, shownDate, type MemberListRow } from '@/features/members/services/list';
import {
  NO_TEAM_VALUE,
  STATUS_ARMED,
  STATUS_BUSY,
  TEAM_MOVE,
  TEAM_UNPICKED_VALUE,
  WITHDRAW,
  offersPositionFor,
  positionPickerDefault,
  teamBlockKey,
  teamConfirmMessageKey,
  teamCurrentLineOf,
  teamOfferMessageKey,
  teamScheduledLineOf,
  teamSelectKey,
  type TeamOffer,
} from '@/features/members/services/write';
import {
  MEMBER_TEAM_DIALOG_HEADING_ID,
  MEMBER_TEAM_ERROR_ID,
  MEMBER_TEAM_HEADING_ID,
} from '@/features/members/utils/element-ids';
import { positionMessageKey, positionOptionsFor } from '@/features/members/utils/position';
import { refusalText } from '@/features/members/utils/refusal-text';
import { teamsMessageKey } from '@/features/teams/services/list';

/**
 * The member page's *Smjena* card (story 1.7b; facts and a dialog since story
 * 7.11): the team today, the change scheduled after it, and `Promijeni` in
 * its header, which opens {@link MemberTeamDialog}. No team, position or date
 * control is mounted on the page. A scheduled change is withdrawn from the
 * card itself, behind its own confirmation.
 *
 * Its own ref, pending flag, refusal and erasure dialog are the hook's; every
 * rule is `@/features/members/services/write`'s and `0010`'s policies. Unlike
 * the status card it IS offered on the caller's own row.
 */
export function MemberTeamCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const {
    form,
    today: organizationToday,
    offersPosition,
    positionsRefusal,
    teamsState,
    teamOffer,
    teamConfirmed,
    teamRefusal,
    teamPending,
    armTeam,
    teamErased,
    teamDialog,
  } = edit;

  /**
   * The card's body: the team today and the change scheduled after it —
   * STATED EVEN WHEN NOTHING IS OFFERED, so the member's team is never left
   * unsaid — then the card's own refusal, the withdrawal, and what a landed
   * change said. Which sentence each line is, is
   * `@/features/members/services/write`'s.
   */
  function renderTeam(member: MemberListRow, today: string): ReactNode {
    const current = teamCurrentLineOf(member, today, offersPosition);
    const scheduled = teamScheduledLineOf(member, today, offersPosition);

    return (
      <CardContent key={teamBlockKey(member)} className="grid gap-4">
        <p className="text-sm font-medium">
          {t(current.key, {
            team: current.team ?? t('smjene.membership.none'),
            position: current.position === null ? NO_TEXT : t(positionMessageKey(current.position)),
          })}
        </p>
        {/* A SCHEDULED CHANGE STANDS OUT (design refresh C), as on the status
            card: the list marks the same change in the team cell. */}
        {scheduled === null ? null : (
          <Callout>
            <CalloutBody>
              <IconTile variant="primary">
                <CalendarClock />
              </IconTile>
              <p className="self-center text-sm font-medium">
                {t(scheduled.key, {
                  date: shownDate(scheduled.date ?? NO_TEXT),
                  team: scheduled.team ?? NO_TEXT,
                  position: scheduled.position === null ? NO_TEXT : t(positionMessageKey(scheduled.position)),
                })}
              </p>
            </CalloutBody>
          </Callout>
        )}
        {positionsRefusal === null ? null : (
          <Notice role="alert">
            {refusalText({ code: positionsRefusal, saved: false })}
          </Notice>
        )}
        {teamsState.refusal === null ? null : (
          <Notice role="alert">
            {t(teamsMessageKey(teamsState.refusal))}
          </Notice>
        )}
        {/* THE CARD'S OWN REFUSAL — a withdrawal refused, or a dialog that
            closed because the record moved — while no dialog says it. */}
        {teamDialog.opening !== null || teamRefusal === null ? null : (
          <Notice id={MEMBER_TEAM_ERROR_ID} role="alert">
            {refusalText(teamRefusal)}
          </Notice>
        )}
        {teamOffer === null ? null : renderWithdrawal(member, teamOffer)}
        {teamConfirmed ? (
          <Notice role="status">
            <span className="block">{t('smjene.membership.saved')}</span>
            {/* WHAT THE GUARDED WRITE REMOVED (story 5.5e), as confirmed in its dialog. */}
            {teamErased === 0 ? null : (
              <span className="mt-2 block">{t('ljudi.erasures.removed', { count: teamErased })}</span>
            )}
          </Notice>
        ) : null}
      </CardContent>
    );
  }

  /** A scheduled move's withdrawal, from the card: one press only arms its confirmation. */
  function renderWithdrawal(member: MemberListRow, offered: TeamOffer): ReactNode {
    if (offered.change !== WITHDRAW) return null;

    return (
      <Button
        ref={teamDialog.withdrawButton}
        className="h-11 w-full sm:w-auto sm:justify-self-start"
        type="button"
        variant="outline"
        disabled={teamPending}
        onClick={() => {
          armTeam(member, offered);
        }}
      >
        {t(teamOfferMessageKey(WITHDRAW), { name: member.name })}
      </Button>
    );
  }

  const member = form.member;

  if (member === null || organizationToday === null) return null;

  return (
    <>
      <Card role="region" aria-labelledby={MEMBER_TEAM_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={MEMBER_TEAM_HEADING_ID} tabIndex={-1}>
              {t('smjene.membership.column')}
            </h2>
          </CardTitle>
          {/* ITS ACCESSIBLE NAME CARRIES THE MEMBER; its visible word is the action. */}
          {teamDialog.available === null ? null : (
            <Button
              ref={teamDialog.opener}
              className="h-11"
              type="button"
              variant="outline"
              aria-label={t(teamOfferMessageKey(TEAM_MOVE), { name: member.name })}
              disabled={teamPending}
              onClick={teamDialog.open}
            >
              {t('smjene.membership.change')}
            </Button>
          )}
        </CardHeader>
        {renderTeam(member, organizationToday)}
      </Card>
      <MemberTeamDialog edit={edit} />
      <MemberTeamWithdrawal edit={edit} />
      <MemberTeamErasures edit={edit} />
    </>
  );
}

/** "Pokušaj ponovno", when what the change would erase could not be checked (story 5.5e). */
function TeamUnchecked({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { teamUnchecked, teamRetryButton, teamPending, retryTeam } = edit;

  if (!teamUnchecked) return null;

  // NOTHING WAS WRITTEN: said here, with a retry of the same change.
  return (
    <Notice id="member-team-unchecked" role="alert">
      {t('ljudi.erasures.unavailable')}
      <Button
        ref={teamRetryButton}
        className="mt-3 flex h-11"
        type="button"
        variant="outline"
        disabled={teamPending}
        onClick={retryTeam}
      >
        {t('ljudi.erasures.retry')}
      </Button>
    </Notice>
  );
}

/**
 * `Promijeni smjenu` (story 7.11): *Nova smjena*, *Položaj* (after a pick,
 * while positions are used) and *Vrijedi od*, behind one Spremi.
 *
 * *NOVA SMJENA STARTS EMPTY* — `Odaberi smjenu`, which cannot be saved — so
 * no hurried press moves anyone. The current team is labelled `sadašnja`; it
 * stays choosable only while positions are used (a position-only change) and
 * is disabled otherwise. Spremi runs the preflight, then the erasure check,
 * then the write; there is no second confirm. Not dismissible while that is
 * in flight; a refusal keeps it open with what was entered; a landed move
 * closes it. Keyed to the opening, so each one starts empty.
 */
export function MemberTeamDialog({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const {
    form,
    offersPosition,
    teamDateField,
    positionField,
    teamRefusal,
    teamDateInvalid,
    teamPickInvalid,
    teamPending,
    pickedTeam,
    pickTeam,
    teamDialog,
  } = edit;
  const opening = teamDialog.opening;
  // THE OFFER THE DIALOG WAS OPENED ON: a re-read never remounts its controls.
  const move = opening?.held.offer ?? null;

  /**
   * The team `<select>`: the placeholder, the current team marked `sadašnja`,
   * the other active teams, then "no team". Described by the dialog's own
   * alert and by nothing else.
   */
  function renderTeamPicker(offered: TeamOffer): ReactNode {
    if (offered.change !== TEAM_MOVE) return null;

    // THE CURRENT TEAM, only while it is a team the picker can resolve: offered
    // among the choices (positions on), or shown disabled (positions off). An
    // archived current team is not offered at all.
    const current =
      offered.current !== null && (!offered.positions || offered.choices.some((choice) => choice.id === offered.current?.id))
        ? offered.current
        : null;

    return (
      <div className="grid gap-2">
        <Label htmlFor="member-team">{t('smjene.membership.team')}</Label>
        <Select
          ref={teamDialog.picker}
          key={teamSelectKey(offered)}
          id="member-team"
          name="team"
          defaultValue={TEAM_UNPICKED_VALUE}
          disabled={teamPending}
          onChange={pickTeam}
          aria-invalid={teamPickInvalid}
          aria-describedby={teamRefusal === null ? undefined : MEMBER_TEAM_ERROR_ID}
          className="h-11"
        >
          <option value={TEAM_UNPICKED_VALUE}>{t('smjene.membership.choose')}</option>
          {/* CHOOSABLE ONLY WHILE POSITIONS ARE USED: the same team with
              another position is a change then, and no change otherwise. */}
          {current === null ? null : (
            <option value={current.id} disabled={!offered.positions}>
              {t('smjene.membership.currentChoice', { team: current.name })}
            </option>
          )}
          {offered.choices
            .filter((choice) => choice.id !== offered.current?.id)
            .map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          {offered.offersNoTeam ? (
            <option value={NO_TEAM_VALUE}>{t('smjene.membership.none')}</option>
          ) : null}
        </Select>
      </div>
    );
  }

  /**
   * The position `<select>`, only while positions are offered and a team is
   * picked. KEYED TO THE PICKED TEAM, so picking another team reopens it on
   * that team's default: the current position for the member's own team, the
   * default position for a move. Described by the dialog's own alert.
   */
  function renderPositionPicker(offered: TeamOffer): ReactNode {
    if (offered.change !== TEAM_MOVE || !offersPositionFor(offered, pickedTeam)) return null;

    const stored = pickedTeam === offered.current?.id ? offered.currentPosition : null;

    return (
      <Fragment key={pickedTeam}>
        <div className="grid gap-2">
          <Label htmlFor="member-position">{t('smjene.position.label')}</Label>
          <Select
            ref={positionField}
            id="member-position"
            name="position"
            defaultValue={positionPickerDefault(offered, pickedTeam)}
            disabled={teamPending}
            aria-describedby={teamRefusal === null ? undefined : MEMBER_TEAM_ERROR_ID}
            className="h-11"
          >
            {positionOptionsFor(stored).map((option) => (
              <option key={option} value={option}>
                {t(positionMessageKey(option))}
              </option>
            ))}
          </Select>
        </div>
      </Fragment>
    );
  }

  /** The dialog's form: the team, the position, the date, and one Spremi. */
  function renderMove(offered: TeamOffer): ReactNode {
    if (offered.change !== TEAM_MOVE) return null;

    return (
      <form
        method="post"
        noValidate
        onSubmit={(event) => {
          void teamDialog.save(event);
        }}
        className="grid gap-5"
      >
        {renderTeamPicker(offered)}
        {renderPositionPicker(offered)}
        <div className="grid gap-2">
          <Label htmlFor="member-team-date">{t('smjene.membership.date')}</Label>
          <Input
            ref={teamDateField}
            id="member-team-date"
            name="teamEffectiveFrom"
            type="date"
            required
            min={offered.minimum}
            defaultValue={offered.minimum}
            readOnly={teamPending}
            aria-describedby={teamRefusal === null ? undefined : MEMBER_TEAM_ERROR_ID}
            aria-invalid={teamDateInvalid}
            className="h-11"
          />
        </div>
        {teamRefusal === null ? null : (
          <Notice id={MEMBER_TEAM_ERROR_ID} role="alert">
            {refusalText(teamRefusal)}
          </Notice>
        )}
        <TeamUnchecked edit={edit} />
        <DialogFooter>
          <Button className="h-11" type="button" variant="outline" disabled={teamPending} onClick={teamDialog.close}>
            {t('smjene.membership.cancel')}
          </Button>
          <Button
            ref={teamDialog.saveButton}
            className="h-11"
            type="submit"
            disabled={teamPending}
            aria-busy={teamPending}
          >
            {t('smjene.membership.save')}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  /** The description: who, and the team — and the position, while shown — they are in now. */
  function renderNow(name: string, offered: TeamOffer): ReactNode {
    if (offered.change !== TEAM_MOVE) return null;

    return <DialogDescription>{nowLine(name, offered)}</DialogDescription>;
  }

  /** "{name} · sada {team}", with the position while shown, or "… · sada bez smjene". */
  function nowLine(name: string, offered: TeamOffer): string {
    if (offered.change !== TEAM_MOVE || offered.current === null) return t('smjene.membership.nowNone', { name });

    const position = offersPosition ? offered.currentPosition : null;

    return position === null
      ? t('smjene.membership.now', { name, team: offered.current.name })
      : t('smjene.membership.nowPosition', { name, team: offered.current.name, position: t(positionMessageKey(position)) });
  }

  return (
    <Dialog
      open={opening !== null && move !== null}
      dismissible={!teamPending}
      onOpenChange={(next) => {
        if (!next) teamDialog.close();
      }}
      // ESCAPE closes through the screen's state, never while a write is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!teamPending) teamDialog.close();
      }}
      aria-labelledby={MEMBER_TEAM_DIALOG_HEADING_ID}
    >
      {opening === null || move === null ? null : (
        <>
          <DialogHeader closeLabel={t('ljudi.page.close')} onClose={teamDialog.close}>
            <DialogTitle id={MEMBER_TEAM_DIALOG_HEADING_ID}>{t('smjene.membership.dialogHeading')}</DialogTitle>
            {renderNow(form.member?.name ?? opening.held.name, move)}
          </DialogHeader>
          <Fragment key={opening.key}>{renderMove(move)}</Fragment>
        </>
      )}
    </Dialog>
  );
}

/**
 * The withdrawal of a scheduled move: its own confirmation, naming the
 * member and the date, open for as long as it is armed. Escape and the
 * backdrop cancel except while the write is outstanding.
 */
function MemberTeamWithdrawal({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { teamArmedFor, teamStage, setTeamArmed, confirmTeam } = edit;

  if (teamArmedFor === null || teamArmedFor.change !== WITHDRAW) return null;

  const busy = teamStage === STATUS_BUSY;
  const armedName = teamArmedFor.name;

  return (
    <ConfirmDialog
      busy={busy}
      onCancel={() => {
        setTeamArmed(null);
      }}
      aria-labelledby="member-team-prompt"
    >
      <p id="member-team-prompt" className="text-sm font-medium">
        {t('smjene.membership.withdrawPrompt', { name: armedName, date: shownDate(teamArmedFor.day) })}
      </p>
      <TeamUnchecked edit={edit} />
      <DialogFooter>
        <Button
          className="h-11"
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setTeamArmed(null);
          }}
        >
          {t('smjene.membership.cancel')}
        </Button>
        <Button
          className="h-11"
          type="button"
          disabled={busy || teamStage !== STATUS_ARMED}
          aria-busy={busy}
          onClick={confirmTeam}
        >
          {t(teamConfirmMessageKey(WITHDRAW), { name: armedName })}
        </Button>
      </DialogFooter>
    </ConfirmDialog>
  );
}

/**
 * THE CHANGE'S ERASURE DIALOG (story 5.5e): the shared `ErasureDialog`, one
 * row per conflict the move or the withdrawal would erase — "{member} na
 * godišnjem · nakon promjene: {team} taj dan bez {member}". Opened over the
 * team dialog, which keeps what was entered, so "Natrag na uređivanje"
 * returns to it. Its save is the confirmation's own words, `aria-disabled`
 * until every row is confirmed. The rows scroll inside it.
 */
function MemberTeamErasures({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, teamErasures, teamPending, confirmTeamErasures } = edit;
  const shown = teamErasures.shown;

  if (shown === null || form.member === null || shown.subject.member !== form.member.id) return null;

  const { confirmation } = shown.subject;

  return (
    <ErasureDialog
      id="member-team-erasures"
      rows={shown.rows}
      changed={shown.changed}
      decisions={teamErasures.decisions}
      busy={teamPending}
      firstErasure={teamErasures.firstErasure}
      copy={memberErasureCopyOf(
        shown.rows,
        t(teamConfirmMessageKey(confirmation.change), { name: confirmation.name }),
      )}
      scrollRows
      onDecide={teamErasures.decide}
      onBack={teamErasures.close}
      onSave={() => {
        void confirmTeamErasures(shown);
      }}
    />
  );
}
