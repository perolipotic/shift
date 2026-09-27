import { CalendarClock } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Callout, CalloutBody } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import { NO_TEXT, shownDate, type MemberListRow } from '@/features/members/services/list';
import {
  NO_TEAM_VALUE,
  STATUS_ARMED,
  STATUS_BUSY,
  STATUS_IDLE,
  TEAM_MOVE,
  offersPositionFor,
  positionPickerDefault,
  teamBlockKey,
  teamConfirmMessageKey,
  teamCurrentLineOf,
  teamOfferMessageKey,
  teamPickerDefault,
  teamPromptKeyOf,
  teamScheduledLineOf,
  teamSelectKey,
  type TeamOffer,
} from '@/features/members/services/write';
import { positionMessageKey, positionOptionsFor } from '@/features/members/utils/position';
import { refusalText } from '@/features/members/utils/refusal-text';
import { teamsMessageKey } from '@/features/teams/services/list';

/**
 * The member edit screen's team card (story 1.7b), drawn only while its block
 * renders.
 *
 * THE SAME SHAPE AS THE STATUS CARD: its own ref, pending flag, armed
 * confirmation and refusal in the hook; a plain PostgREST insert of a
 * membership version or the delete of the scheduled one; every rule `0010`'s
 * policies. Unlike the status card it IS offered on the caller's own row. The
 * team and date controls are uncontrolled and stay mounted through the
 * confirmation, so a refusal keeps both.
 *
 * TEAM POSITION joins it while the organization uses fire ranks and positions:
 * a position `<select>` beside the team, shown only while a team (not "no
 * team") is picked. Its visibility and its default are
 * `@/features/members/services/write`'s decisions.
 */
export function MemberTeamCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const {
    form,
    today,
    teamDateField,
    positionField,
    offersPosition,
    positionsRefusal,
    teamsState,
    teamOffer,
    teamArmedFor,
    teamConfirmed,
    teamRefusal,
    teamDateInvalid,
    teamStage,
    pickedTeam,
    setTeamArmed,
    armTeam,
    pickTeam,
    changeTeam,
  } = edit;

  /**
   * The team block: the team today, the move scheduled after it, and the one
   * thing offered — a move from a date, or the scheduled move's cancellation —
   * or its confirmation. No team is said in words (`Bez smjene`).
   *
   * THE PICKER AND THE DATE STAY MOUNTED across every stage, disabled while a
   * confirmation stands, so a refused move returns to the offer with both
   * still as entered. Keyed to the member's team history.
   */
  function renderTeam(): ReactNode {
    const member = form.member;

    if (member === null || today === null) return null;

    const idle = teamStage === STATUS_IDLE;
    // STATED EVEN WHEN NOTHING IS OFFERED — no teams to move onto, or the
    // teams unread — so the member's team is never left unsaid.
    // Both lines, and which sentence each is, are `@/features/members/services/write`'s: the
    // position only while shown, and a scheduled change that keeps the team
    // never worded as a move onto it.
    const current = teamCurrentLineOf(member, today, offersPosition);
    const scheduled = teamScheduledLineOf(member, today, offersPosition);

    return (
      <div key={teamBlockKey(member)} className="grid gap-2">
        <p className="text-sm font-medium">
          {t(current.key, {
            team: current.team ?? t('smjene.membership.none'),
            position: current.position === null ? NO_TEXT : t(positionMessageKey(current.position)),
          })}
        </p>
        {/* A SCHEDULED CHANGE STANDS OUT (design refresh C), as on the
            status card: the list marks the same change in the team cell. */}
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
                  position:
                    scheduled.position === null ? NO_TEXT : t(positionMessageKey(scheduled.position)),
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
        {teamRefusal === null ? null : (
          <Notice id="member-team-error" role="alert">
            {refusalText(teamRefusal)}
          </Notice>
        )}
        {/* AN ARMED OR PENDING CONFIRMATION OUTLIVES ITS OFFER: a refetch that
            empties the offer mid-write must not take the busy state with it. */}
        {teamOffer === null
          ? renderTeamConfirmation(today)
          : renderTeamControls(member, teamOffer, idle, today)}
        {teamConfirmed ? (
          <Notice role="status">
            {t('smjene.membership.saved')}
          </Notice>
        ) : null}
      </div>
    );
  }

  /** The picker and date for a move, then the offer or its confirmation. */
  function renderTeamControls(
    member: MemberListRow,
    offered: TeamOffer,
    idle: boolean,
    today: string,
  ): ReactNode {
    return (
      <>
        {renderTeamPicker(offered, idle)}
        {idle ? renderTeamOffer(member, offered) : renderTeamConfirmation(today)}
      </>
    );
  }

  /**
   * The team `<select>` and the date, for a move. A cancellation names the
   * scheduled version's own date and offers neither. Described by the team
   * block's own alert and by nothing else.
   */
  function renderTeamPicker(offered: TeamOffer, idle: boolean): ReactNode {
    if (offered.change !== TEAM_MOVE) return null;

    return (
      <>
        <Label htmlFor="member-team">{t('smjene.membership.team')}</Label>
        <Select
          key={teamSelectKey(offered)}
          id="member-team"
          name="team"
          defaultValue={teamPickerDefault(offered)}
          disabled={!idle}
          onChange={pickTeam}
          aria-describedby={teamRefusal === null ? undefined : 'member-team-error'}
          className="h-11"
        >
          {offered.choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
          {offered.offersNoTeam ? (
            <option value={NO_TEAM_VALUE}>{t('smjene.membership.none')}</option>
          ) : null}
        </Select>
        {renderPositionPicker(offered, idle)}
        <Label htmlFor="member-team-date">{t('smjene.membership.date')}</Label>
        <Input
          ref={teamDateField}
          id="member-team-date"
          name="teamEffectiveFrom"
          type="date"
          required
          min={offered.minimum}
          defaultValue={offered.minimum}
          disabled={!idle}
          aria-describedby={teamRefusal === null ? undefined : 'member-team-error'}
          aria-invalid={teamDateInvalid}
          className="h-11"
        />
      </>
    );
  }

  /**
   * The position `<select>`, only while positions are offered and a team is
   * picked. KEYED TO THE PICKED TEAM, so picking another team reopens it on
   * that team's default: the current position for the member's own team, the
   * default position for a move. Described by the team block's own alert.
   */
  function renderPositionPicker(offered: TeamOffer, idle: boolean): ReactNode {
    if (offered.change !== TEAM_MOVE || !offersPositionFor(offered, pickedTeam)) return null;

    const stored = pickedTeam === offered.current?.id ? offered.currentPosition : null;

    return (
      <Fragment key={pickedTeam}>
        <Label htmlFor="member-position">{t('smjene.position.label')}</Label>
        <Select
          ref={positionField}
          id="member-position"
          name="position"
          defaultValue={positionPickerDefault(offered, pickedTeam)}
          disabled={!idle}
          aria-describedby={teamRefusal === null ? undefined : 'member-team-error'}
          className="h-11"
        >
          {positionOptionsFor(stored).map((option) => (
            <option key={option} value={option}>
              {t(positionMessageKey(option))}
            </option>
          ))}
        </Select>
      </Fragment>
    );
  }

  /** The offer, naming the member it acts on. One press sends nothing. */
  function renderTeamOffer(member: MemberListRow, offered: TeamOffer): ReactNode {
    return (
      <Button
        className="h-11 w-full"
        type="button"
        variant="outline"
        onClick={() => {
          armTeam(member, offered);
        }}
      >
        {t(teamOfferMessageKey(offered.change), { name: member.name })}
      </Button>
    );
  }

  /**
   * The confirmation, naming the member, the team and the date. Its tense reads
   * TODAY AS IT IS NOW, the day the write will be judged against.
   */
  function renderTeamConfirmation(today: string): ReactNode {
    if (teamArmedFor === null) return null;

    const busy = teamStage === STATUS_BUSY;
    const armedName = teamArmedFor.name;

    // IN A MODAL (design refresh C), open for as long as it is rendered: the
    // armed state is the screen's as before, and Escape or the backdrop cancel
    // except while the write is outstanding.
    return (
      <ConfirmDialog
        busy={busy}
        onCancel={() => {
          setTeamArmed(null);
        }}
        aria-labelledby="member-team-prompt"
      >
        <p id="member-team-prompt" className="text-sm font-medium">
          {t(teamPromptKeyOf(teamArmedFor, today), {
            name: armedName,
            date: shownDate(teamArmedFor.day),
            team: teamArmedFor.team?.name ?? NO_TEXT,
            position:
              teamArmedFor.position === null ? NO_TEXT : t(positionMessageKey(teamArmedFor.position)),
          })}
        </p>
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
            onClick={() => {
              void changeTeam();
            }}
          >
            {t(teamConfirmMessageKey(teamArmedFor.change), { name: armedName })}
          </Button>
        </DialogFooter>
      </ConfirmDialog>
    );
  }

  const teamBlock = renderTeam();

  return teamBlock === null ? null : (
    <Card className="w-full min-w-0 max-w-2xl">
      <CardHeader>
        <CardTitle asChild>
          <h2>{t('smjene.membership.column')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{teamBlock}</CardContent>
    </Card>
  );
}
