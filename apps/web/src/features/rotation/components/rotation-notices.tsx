import { useQueryClient } from '@tanstack/react-query';
import { Save, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import type { RotationBuilder } from '@/features/rotation/hooks/use-rotation-builder';
import type { ScheduledChange } from '@/features/rotation/services/history';
import { ROTATION_KEY, rotationMessageKey, rotationRetryMessageKey } from '@/features/rotation/services/list';
import {
  ROTATION_CANCELLED_MESSAGE_KEY,
  ROTATION_SAVED_MESSAGE_KEY,
  rotationCancelMessageKey,
  rotationPartialMessageKey,
  rotationWriteMessageKey,
} from '@/features/rotation/services/write';
import { ROTATION_SCHEDULED } from '@/features/rotation/utils/draft';
import {
  warningTextOf,
  warningsSummaryOf,
  type RotationWarningLine,
  type WarningTranslate,
} from '@/features/rotation/utils/warnings';
import { retryRead } from '@/features/teams/services/dependents';
import { t } from '@/lib/i18n';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * The builder's notices, right under its header (stories 2.3b–2.6, 5.5a,
 * 5.5g; split out of `RotationSection` by the epics 5–7 retro, A21): the
 * save's refusal with the cancel's offer beside the scheduled one, the
 * cancel's confirmation, a check that could not be derived with its retry,
 * the save's and the cancel's erasure dialogs, what a landed save or cancel
 * says, and the read's own refusal with its retry.
 */
export function RotationNotices({ builder }: { readonly builder: RotationBuilder }) {
  const queryClient = useQueryClient();
  const {
    refusal,
    retryable,
    pending,
    outcome,
    scheduled,
    cancelShown,
    cancelled,
    cancelErasedCount,
    erasedCount,
    savedPending,
    erasuresUnavailable,
    erasures,
    erasureWarnings,
    confirmation,
    cancelErasures,
    cancelUnchecked,
    setCancelUnchecked,
    setCancelArmed,
    retryButton,
    cancelOfferButton,
    cancelRetryButton,
    cancelConfirmation,
    requestSave,
    confirmErasures,
    cancelScheduled,
    confirmCancelErasures,
  } = builder;

  /**
   * The cancel's confirmation, in a modal open for as long as it is rendered;
   * Escape or the backdrop dismiss it except while the delete is outstanding.
   * Neutral, never `destructive`.
   */
  function renderCancelConfirmation(change: ScheduledChange): ReactNode {
    return (
      <ConfirmDialog
        busy={pending}
        onCancel={() => {
          setCancelArmed(null);
          setCancelUnchecked(null);
        }}
        aria-labelledby="rotation-cancel-prompt"
      >
        <p id="rotation-cancel-prompt" className="text-sm font-medium">
          {t('rotation.builder.cancelScheduled.prompt', { date: change.label })}
        </p>
        {/* STORY 5.5g: a cancel that could not check what it would erase deleted nothing. */}
        {cancelUnchecked !== null ? (
          <Notice role="alert">
            {t('rotation.builder.cancelScheduled.erasures.unavailable')}
            <Button
              ref={cancelRetryButton}
              className="mt-3 flex h-11"
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                // THE DATE THAT WAS CONFIRMED, never the snapshot's now: a
                // change re-dated meanwhile goes down the STALE path.
                void cancelScheduled(cancelUnchecked);
              }}
            >
              {t('rotation.builder.cancelScheduled.erasures.retry')}
            </Button>
          </Notice>
        ) : null}
        <DialogFooter>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setCancelArmed(null);
              setCancelUnchecked(null);
            }}
          >
            {t('rotation.builder.cancelScheduled.keep')}
          </Button>
          <Button
            className="h-11"
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => {
              void cancelScheduled(change.effectiveFrom);
            }}
          >
            {t('rotation.builder.cancelScheduled.confirm')}
          </Button>
        </DialogFooter>
      </ConfirmDialog>
    );
  }

  /**
   * The draft's warnings (story 2.5) as lines: the summary, then each line
   * with its dates. SPANS WITH LIST ROLES, because the save's Notice is a
   * `<p>` and a `<ul>` may not sit in one. Nothing when there is none.
   */
  function renderWarnings(lines: readonly RotationWarningLine[]): ReactNode {
    if (lines.length === 0) return null;

    return (
      <>
        <span className="mt-2 block">{warningTextOf(warningsSummaryOf(lines), translate)}</span>
        <span role="list" className="mt-1 grid gap-1">
          {lines.map((line, index) => (
            <span role="listitem" key={index} className="block">
              {warningTextOf(line.text, translate)}
              {line.details.length === 0 ? null : (
                <span role="list" className="mt-0.5 grid gap-0.5 pl-4 font-normal">
                  {line.details.map((detail, detailIndex) => (
                    <span role="listitem" key={detailIndex} className="block">
                      {warningTextOf(detail, translate)}
                    </span>
                  ))}
                </span>
              )}
            </span>
          ))}
        </span>
      </>
    );
  }

  /**
   * The erasure confirmation (story 5.5a, mockup `setup-1.html` §2), the
   * shared `ErasureDialog` (story 5.5b) in the builder's words: one row per
   * conflict the draft would erase, by date then team, and the draft's
   * warnings, which never block. "Spremi rotaciju" is `aria-disabled` until
   * every row is confirmed; "Natrag na uređivanje", Escape and the backdrop
   * close it and keep the draft.
   */
  function renderErasures(shown: NonNullable<typeof erasures>): ReactNode {
    const { rows } = shown;
    const partsOf = (row: (typeof rows)[number]) => ({
      team: row.teamName,
      weekday: row.weekday,
      date: row.dayMonth,
      type: row.shiftTypeName,
    });

    return (
      <ErasureDialog
        id="rotation-erasures"
        rows={rows}
        changed={shown.changed}
        decisions={confirmation.decisions}
        busy={pending}
        firstErasure={confirmation.firstErasure}
        copy={{
          title: t('rotation.builder.erasures.title', { count: rows.length }),
          lede: t('rotation.builder.erasures.lede', { count: rows.length }),
          changed: t('rotation.builder.erasures.changed'),
          rowTitle: (row) => t('rotation.builder.erasures.rowTitle', partsOf(row)),
          rowDetail: (row) =>
            row.teamWorks
              ? t('rotation.builder.erasures.rowWithout', { member: row.memberName, team: row.teamName })
              : t('rotation.builder.erasures.rowFree', { member: row.memberName, team: row.teamName }),
          decision: (row) => t('rotation.builder.erasures.decision', partsOf(row)),
          confirm: t('rotation.builder.erasures.confirm'),
          keep: t('rotation.builder.erasures.keep'),
          back: t('rotation.builder.erasures.back'),
          kept: t('rotation.builder.erasures.kept'),
          save: t('rotation.builder.save'),
        }}
        saveIcon={<Save aria-hidden />}
        notes={renderWarnings(erasureWarnings)}
        onDecide={confirmation.decide}
        onBack={confirmation.close}
        onSave={() => {
          void confirmErasures(shown);
        }}
      />
    );
  }

  /**
   * The cancel's erasure dialog (story 5.5g), the shared `ErasureDialog` in
   * the cancel's own words, opened after its confirmation: one row per
   * conflict the cancel would erase, by date then team. Its confirm is the
   * cancel's own label and `aria-disabled` until every row is confirmed;
   * "Natrag na uređivanje", Escape and the backdrop close it and keep the
   * scheduled change.
   */
  function renderCancelErasures(shown: NonNullable<typeof cancelErasures.shown>): ReactNode {
    const { rows } = shown;
    const partsOf = (row: (typeof rows)[number]) => ({
      team: row.teamName,
      weekday: row.weekday,
      date: row.dayMonth,
      type: row.shiftTypeName,
    });

    return (
      <ErasureDialog
        id="rotation-cancel-erasures"
        rows={rows}
        changed={shown.changed}
        decisions={cancelErasures.decisions}
        busy={pending}
        firstErasure={cancelErasures.firstErasure}
        copy={{
          title: t('rotation.builder.cancelScheduled.erasures.title', { count: rows.length }),
          lede: t('rotation.builder.cancelScheduled.erasures.lede', { count: rows.length }),
          changed: t('rotation.builder.cancelScheduled.erasures.changed'),
          rowTitle: (row) => t('rotation.builder.cancelScheduled.erasures.rowTitle', partsOf(row)),
          rowDetail: (row) =>
            row.teamWorks
              ? t('rotation.builder.cancelScheduled.erasures.rowWithout', { member: row.memberName, team: row.teamName })
              : t('rotation.builder.cancelScheduled.erasures.rowFree', { member: row.memberName, team: row.teamName }),
          decision: (row) => t('rotation.builder.cancelScheduled.erasures.decision', partsOf(row)),
          confirm: t('rotation.builder.cancelScheduled.erasures.confirm'),
          keep: t('rotation.builder.cancelScheduled.erasures.keep'),
          back: t('rotation.builder.cancelScheduled.erasures.back'),
          kept: t('rotation.builder.cancelScheduled.erasures.kept'),
          save: t('rotation.builder.cancelScheduled.confirm'),
        }}
        saveIcon={<Undo2 aria-hidden />}
        onDecide={cancelErasures.decide}
        onBack={cancelErasures.close}
        onSave={() => {
          void confirmCancelErasures(shown);
        }}
      />
    );
  }

  const partial = outcome === null ? null : rotationPartialMessageKey(outcome);
  // THE CANCEL IS OFFERED ONLY BESIDE THE SCHEDULED REFUSAL, and only while a
  // change is still scheduled in the snapshot.
  const cancelOffered = scheduled !== null && outcome !== null && !outcome.ok && outcome.code === ROTATION_SCHEDULED;
  /** The change whose cancel confirmation is open, while the snapshot still schedules it. */
  const confirming = cancelShown ? scheduled : null;

  /** A warning's words, every one from `hr.json`, resolved by `@/features/rotation/utils/warnings`. */
  const translate: WarningTranslate = (key, values) => t(key, values);

  return (
    <>
      {outcome === null || outcome.ok ? null : (
        <Notice role="alert">
          {t(rotationWriteMessageKey(outcome.code))}
          {partial === null ? null : <> {t(partial)}</>}
          {cancelOffered ? (
            <Button
              ref={cancelOfferButton}
              className="mt-3 flex h-11"
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setCancelUnchecked(null);
                setCancelArmed(scheduled.effectiveFrom);
              }}
            >
              <Undo2 aria-hidden />
              {t('rotation.builder.cancelScheduled.offer', { date: scheduled.label })}
            </Button>
          ) : null}
        </Notice>
      )}
      {confirming === null ? null : renderCancelConfirmation(confirming)}
      {/* STORY 5.5a: a save that could not check what it would erase saved nothing. */}
      {erasuresUnavailable ? (
        <Notice role="alert">
          {t('rotation.builder.erasures.unavailable')}
          <Button
            ref={retryButton}
            className="mt-3 flex h-11"
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              void requestSave();
            }}
          >
            {t('rotation.builder.erasures.retry')}
          </Button>
        </Notice>
      ) : null}
      {erasures === null ? null : renderErasures(erasures)}
      {cancelErasures.shown === null ? null : renderCancelErasures(cancelErasures.shown)}
      {cancelled === null ? null : cancelled.ok ? (
        <Notice ref={cancelConfirmation} tabIndex={-1} role="status">
          <span className="block">{t(ROTATION_CANCELLED_MESSAGE_KEY)}</span>
          {/* STORY 5.5g: how many conflicts the cancel removed, as confirmed in its dialog. */}
          {cancelErasedCount === 0 ? null : (
            <span className="mt-2 block">
              {t('rotation.builder.cancelScheduled.erasures.removed', { count: cancelErasedCount })}
            </span>
          )}
        </Notice>
      ) : (
        <Notice role="alert">{t(rotationCancelMessageKey(cancelled.code))}</Notice>
      )}
      {outcome?.ok === true ? (
        <Notice role="status">
          {/* The confirmation on its own line, and its own element, whether
              or not warnings follow it. */}
          <span className="block">{t(ROTATION_SAVED_MESSAGE_KEY)}</span>
          {/* STORY 5.5a: how many conflicts the save removed, as confirmed in its dialog. */}
          {erasedCount === 0 ? null : (
            <span className="mt-2 block">{t('rotation.builder.erasures.removed', { count: erasedCount })}</span>
          )}
          {savedPending === null || savedPending === 0 ? null : (
            <span className="mt-2 block">{t('rotation.builder.overrides.count', { count: savedPending })}</span>
          )}
          {renderWarnings(outcome.warnings)}
        </Notice>
      ) : null}
      {refusal === null ? null : (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t(rotationMessageKey(refusal))}</Notice>
          {/* STORY 8.2d: no read retry offline; it comes back with the connection.
              If this retry has focus when it goes, `keepFocusOnAlert` moves focus to the alert. */}
          {retryable ? (
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={() => {
                void retryRead(queryClient, ROTATION_KEY);
              }}
            >
              {t(rotationRetryMessageKey(refusal))}
            </Button>
          ) : null}
        </div>
      )}
    </>
  );
}
