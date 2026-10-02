import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { RadioGroup } from '@/components/ui/radio-group';
import { CONFLICT_GLYPH } from '@/features/calendar/utils/modifiers';
import { AcceptUncoveredOption, AmendLeaveOption, ReplaceMemberOption } from '@/features/conflicts/components/resolution-option';
import { ReplacementPicker } from '@/features/conflicts/components/replacement-picker';
import { ResolutionSkeleton } from '@/features/conflicts/components/resolution-skeleton';
import type { ConflictResolutionState } from '@/features/conflicts/hooks/use-conflict-resolution';
import {
  NO_OPTION,
  OPTION_REPLACE_MEMBER,
  RESOLUTION_CHOICE_HEADING_ID,
  RESOLUTION_LOADING,
  RESOLUTION_MISSING,
  RESOLUTION_SAVE_HINT_ID,
  RESOLUTION_UNAVAILABLE,
  coworkersMessageKey,
  readyToSave,
  saveHintMessageKey,
  shiftFactsMessageKey,
  type ResolutionLink,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import {
  RESOLUTION_GONE,
  resolutionFailureLineOf,
  resolutionFailureMessageKey,
  type ResolutionWriteFailure,
} from '@/features/conflicts/services/resolution-write';
import { rosterLineOf } from '@/features/members/utils/position';
import { formatList } from '@/lib/i18n/format';
import { t } from '@/lib/i18n';
import { initialsOf } from '@/utils/initials';

/** The way back to the queue, always rendered: with the count once it is known. */
function BackLink({ count, disabled = false }: { readonly count: number | null; readonly disabled?: boolean }): ReactNode {
  return (
    <Button asChild variant="ghost" className="-ml-3 h-11 px-3 aria-disabled:opacity-50">
      <Link to="/raspored" disabled={disabled}>
        <ChevronLeft aria-hidden />
        {count === null ? t('raspored.resolution.backToQueue') : t('raspored.resolution.back', { count })}
      </Link>
    </Button>
  );
}

/** ‹ and ›: the adjacent unresolved conflicts, nothing saved; disabled at each end. */
function ConflictNav({
  view,
  pending,
  onGo,
}: {
  readonly view: ResolutionView;
  readonly pending: boolean;
  readonly onGo: (link: ResolutionLink | null) => void;
}): ReactNode {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-11 w-11 p-0"
        aria-label={
          view.previous === null
            ? t('raspored.resolution.previousNone')
            : t('raspored.resolution.previous', { date: view.previous.dayMonth })
        }
        disabled={view.previous === null || pending}
        onClick={() => {
          onGo(view.previous);
        }}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-11 p-0"
        aria-label={
          view.next === null ? t('raspored.resolution.nextNone') : t('raspored.resolution.next', { date: view.next.dayMonth })
        }
        disabled={view.next === null || pending}
        onClick={() => {
          onGo(view.next);
        }}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}

/** The facts: the shift, the absent member and their leave, and who else works that day. */
function ResolutionFacts({ view }: { readonly view: ResolutionView }): ReactNode {
  // WHICH SENTENCE is `rosterLineOf`'s decision, executed in a test.
  const line = rosterLineOf(view.memberName, view.rankKey, view.positionKey, (key) => t(key));

  return (
    <Card className="grid min-w-0 gap-4 p-4">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="outline" className="gap-1">
          <span aria-hidden>{CONFLICT_GLYPH}</span>
          {t('raspored.resolution.mark')}
        </Badge>
        <span className="min-w-0 break-words font-medium">
          {t(shiftFactsMessageKey(view.times), {
            type: view.shiftTypeName,
            times: view.times ?? undefined,
            team: view.teamName,
            date: view.dateShown,
          })}
        </span>
      </p>
      <div className="flex min-w-0 items-start gap-3">
        <Avatar>{initialsOf(view.memberName)}</Avatar>
        <div className="grid min-w-0 gap-0.5">
          <p className="min-w-0 break-words font-semibold">{line.key === null ? line.text : t(line.key, line.values)}</p>
          <p className="min-w-0 break-words text-sm text-muted-foreground">
            {t('raspored.resolution.leave', { from: view.leaveFrom, to: view.leaveTo, days: view.leaveCostDays })}
          </p>
        </div>
      </div>
      <p className="min-w-0 break-words border-t pt-3 text-sm text-muted-foreground">
        {t(coworkersMessageKey(view.coworkers), { team: view.teamName, names: formatList(view.coworkers) })}
      </p>
    </Card>
  );
}

/** A refusal's line: the taken one names who was already on the shift (story 5.4c), and is never drawn without the name. */
function FailureNotice({ failure, taken }: { readonly failure: ResolutionWriteFailure; readonly taken: string | null }): ReactNode {
  const line = resolutionFailureLineOf(failure, taken);

  return <Notice role="alert">{line.values === undefined ? t(line.key) : t(line.key, line.values)}</Notice>;
}

/** The ready screen: the header with ‹ ›, the facts, the choice and the footer. */
function ResolutionReady({ state, view }: { readonly state: ConflictResolutionState; readonly view: ResolutionView }): ReactNode {
  const { choice, choose, pending, failure, save, go, firstOption, firstCandidate, replaceOption, candidatesExist, replacement, pick, taken } =
    state;
  const pickedId = replacement?.id ?? null;
  const waiting = !readyToSave(choice, pickedId);
  const gone = failure === RESOLUTION_GONE;

  return (
    <>
      <PageHeader className="flex-row flex-nowrap items-start justify-between sm:flex-nowrap">
        <div className="grid min-w-0 justify-items-start gap-1">
          <BackLink count={view.count} disabled={pending} />
          <PageTitle asChild>
            <h1>{t('raspored.resolution.heading')}</h1>
          </PageTitle>
          <PageDescription>
            {t('raspored.resolution.position', { position: view.position, count: view.count })}
          </PageDescription>
        </div>
        <ConflictNav view={view} pending={pending} onGo={go} />
      </PageHeader>
      <ResolutionFacts view={view} />
      <section className="grid min-w-0 gap-3" aria-labelledby={RESOLUTION_CHOICE_HEADING_ID}>
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id={RESOLUTION_CHOICE_HEADING_ID} className="text-base font-semibold">
            {t('raspored.resolution.choice')}
          </h2>
          <span className="text-sm text-muted-foreground">{t('raspored.resolution.choiceHint')}</span>
        </div>
        <RadioGroup
          aria-labelledby={RESOLUTION_CHOICE_HEADING_ID}
          value={choice ?? NO_OPTION}
          onValueChange={choose}
          disabled={pending}
        >
          <AcceptUncoveredOption view={view} optionRef={firstOption} />
          <ReplaceMemberOption
            view={view}
            optionRef={replaceOption}
            replacementName={choice === OPTION_REPLACE_MEMBER ? (replacement?.name ?? null) : null}
          />
          <AmendLeaveOption view={view} />
        </RadioGroup>
        {/* A sibling after the cards, never inside one: a card is a `<button>`, and the group is one arrow-key group of three. */}
        {choice === OPTION_REPLACE_MEMBER ? (
          <ReplacementPicker
            view={view}
            value={pickedId}
            onValueChange={pick}
            disabled={pending}
            firstCandidate={firstCandidate}
          />
        ) : null}
        {failure === null ? null : <FailureNotice failure={failure} taken={taken} />}
        {/* GONE: nothing left to save, and the header's way back is the one way on. */}
        {gone ? null : (
          <div className="flex min-w-0 flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
            <p id={RESOLUTION_SAVE_HINT_ID} className="min-w-0 flex-1 break-words text-sm text-muted-foreground">
              {t(saveHintMessageKey(choice, pickedId, candidatesExist, view.amend.target.kind), {
                date: view.amend.dateShown ?? undefined,
              })}
            </p>
            <Button asChild variant="outline" className="h-11 w-full sm:w-auto">
              <Link to="/raspored" disabled={pending}>
                {t('raspored.resolution.cancel')}
              </Link>
            </Button>
            <Button
              type="button"
              className="h-11 w-full sm:w-auto aria-disabled:opacity-50"
              aria-disabled={waiting || pending}
              aria-describedby={RESOLUTION_SAVE_HINT_ID}
              onClick={() => {
                void save((member) => t('raspored.resolution.replaceReason', { member }));
              }}
            >
              {pending ? t('raspored.resolution.saving') : t('raspored.resolution.save')}
            </Button>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * What one conflict's screen shows (story 5.4b): the skeleton while the reads
 * are unanswered, one alert with a retry when a read failed, the line a
 * conflict no longer open states with its way back, and otherwise the
 * screen. `resolutionScreenOf` decides which; this only draws it. The way
 * back is drawn in every state.
 */
export function ConflictResolutionBody({ state }: { readonly state: ConflictResolutionState }): ReactNode {
  const { screen, retry, failure } = state;

  if (screen.kind === RESOLUTION_LOADING || screen.kind === RESOLUTION_UNAVAILABLE || screen.kind === RESOLUTION_MISSING) {
    return (
      <>
        <PageHeader>
          <div className="grid min-w-0 justify-items-start gap-1">
            <BackLink count={screen.kind === RESOLUTION_MISSING ? screen.count : null} />
            <PageTitle asChild>
              <h1>{t('raspored.resolution.heading')}</h1>
            </PageTitle>
          </div>
        </PageHeader>
        {screen.kind === RESOLUTION_LOADING ? <ResolutionSkeleton /> : null}
        {/* A save refused as no longer open keeps saying so once the re-read takes the conflict away. */}
        {screen.kind === RESOLUTION_MISSING && failure === RESOLUTION_GONE ? (
          <Notice role="alert">{t(resolutionFailureMessageKey(failure))}</Notice>
        ) : null}
        {screen.kind === RESOLUTION_MISSING && failure !== RESOLUTION_GONE ? (
          <Notice role="status">{t('raspored.resolution.missing')}</Notice>
        ) : null}
        {screen.kind === RESOLUTION_UNAVAILABLE ? (
          <div className="grid min-w-0 gap-2">
            <Notice role="alert">{t('raspored.resolution.unavailable')}</Notice>
            <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={retry}>
              {t('raspored.resolution.retry')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return <ResolutionReady state={state} view={screen.view} />;
}
