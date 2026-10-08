import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';

import type { BrandAccentKey } from '@/features/organization/utils/accent';
import {
  LOGO_UNAVAILABLE,
  ORGANIZATION_LOGO_BUCKET,
  replaceOrganizationLogo,
  type LogoFailure,
} from '@/features/organization/services/logo';
import { useRenderableLogo } from '@/features/organization/hooks/logo-url';
import {
  ORGANIZATION_LEAVE_DAY_FIELD,
  ORGANIZATION_LEAVE_MONTH_FIELD,
  ORGANIZATION_NAME_FIELD,
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  ORGANIZATION_UNAVAILABLE,
  readFailureOf,
  readOrganization,
  updateOrganization,
  type OrganizationFailure,
  type OrganizationField,
  type OrganizationOutcome,
  type OrganizationSnapshot,
} from '@/features/organization/services/snapshot';
import {
  ORGANIZATION_DIALOG_CARD_HEADING_IDS,
  ORGANIZATION_DIALOG_SAVE_ID,
  ORGANIZATION_LEAVE_DAY_FIELD_ID,
  ORGANIZATION_LEAVE_MONTH_FIELD_ID,
  ORGANIZATION_NAME_FIELD_ID,
} from '@/features/organization/utils/element-ids';
import {
  ACCENT_DIALOG,
  FIRE_RANKS_DIALOG,
  LEAVE_YEAR_DIALOG,
  LOGO_DIALOG,
  NAME_DIALOG,
  type OrganizationDialog,
} from '@/features/organization/utils/dialogs';
import { offersReadRetry } from '@/features/organization/utils/messages';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * One opening of a dialog: which one, and a fresh key, so each opening draws
 * its body anew from the row as it is now, while a refetch during one leaves
 * what was entered alone.
 */
export interface OrganizationDialogOpening {
  readonly dialog: OrganizationDialog;
  readonly key: number;
}

/**
 * The control a refused write names, by id. The accent's radio group is marked
 * `aria-invalid` but takes no focus of its own: a refusal that names it
 * returns focus to Spremi, beside the alert.
 */
const REFUSED_FIELD_IDS: Partial<Record<OrganizationField, string>> = {
  name: ORGANIZATION_NAME_FIELD_ID,
  leaveYearStartDay: ORGANIZATION_LEAVE_DAY_FIELD_ID,
  leaveYearStartMonth: ORGANIZATION_LEAVE_MONTH_FIELD_ID,
};

/**
 * What a dialog's write answers: the row write's outcome, or the logo's — which
 * never names a field, so a refusal reads the same way from either.
 */
type DialogOutcome =
  | OrganizationOutcome
  | { readonly ok: false; readonly code: LogoFailure; readonly field?: undefined };

/** The element whose id this is, for a focus target drawn by another component. */
function byId(id: string): () => HTMLElement | null {
  return () => document.getElementById(id);
}

/** The heading of the card a dialog closes onto, for a focus whose opener is gone. */
function cardHeading(dialog: OrganizationDialog): () => HTMLElement | null {
  return () => document.getElementById(ORGANIZATION_DIALOG_CARD_HEADING_IDS[dialog]);
}

/**
 * `/organizacija`'s state, its one read and its five writes (stories 1.4a,
 * 1.4b, 1.4c and member rank; facts and dialogs since story 7.18). The page
 * composes the header and the fact cards, and each card is a component in
 * `@/features/organization/components` that reads this hook's result.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). Every value the page draws comes from
 * the single `useQuery` below under `ORGANIZATION_SNAPSHOT_KEY`; there is no
 * second read on this screen and there must not be one, because independent
 * keys are precisely what put a stale figure beside a fresh one.
 *
 * THE DIALOGS (story 7.18, the member page's pattern from 7.11). Each change
 * opens its own small dialog with one Spremi. The hook owns which one is open
 * (`opening`, keyed per opening) and the button that opened each (`openers`).
 * Nothing writes on change any more: the accent and the fire-rank setting
 * used to save the instant they changed, and the logo the instant a file was
 * picked; now each is chosen in its dialog and sent by its Spremi. While a
 * write is in flight the dialog cannot be dismissed. A refusal keeps it open
 * with its alert above the buttons and what was entered, and marks and
 * focuses the control the database named. A landed save closes it, says so on
 * the card it closed onto (`saved`), and returns focus to its opener.
 *
 * ONE WRITE AT A TIME, because only one dialog is open at a time — which is
 * what retired the queues the on-change writes needed (`queuedAccent`, the
 * fire-rank queue) and the flags that locked one control while another wrote.
 *
 * THE SEPARATION IS STILL A TYPE. `@/features/organization/services/snapshot`
 * types the identity write, `{ logoPath }`, `{ brandAccent }` and
 * `{ usesFireRanks }` as disjoint shapes, and each dialog sends exactly one.
 * The name and the leave year's start share the identity write: each fills
 * the fields it does not show from the snapshot as it is at submit time, and
 * the type and the zone go back unchanged, as they always have (FR-7, FR-8).
 *
 * A FAILED WRITE IS THE WRITE'S, NEVER THE REFETCH'S. The invalidation that
 * follows a landed write sits in a `try` of its own, so a refetch that rejects
 * is logged and never reported as a refusal of a value the row already holds.
 */
export function useOrganizationSettings() {
  const queryClient = useQueryClient();
  /** Counts openings, so every opening of any dialog gets a key of its own. */
  const openings = useRef(0);
  const nameOpener = useRef<HTMLButtonElement>(null);
  const logoOpener = useRef<HTMLButtonElement>(null);
  const accentOpener = useRef<HTMLButtonElement>(null);
  const leaveYearOpener = useRef<HTMLButtonElement>(null);
  const fireRanksOpener = useRef<HTMLButtonElement>(null);
  const openers: Readonly<Record<OrganizationDialog, RefObject<HTMLButtonElement | null>>> = {
    name: nameOpener,
    logo: logoOpener,
    accent: accentOpener,
    leaveYear: leaveYearOpener,
    fireRanks: fireRanksOpener,
  };
  // A REF as well as state: state drives the busy dialog, and state is stale
  // inside a handler already called once this tick.
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [opening, setOpening] = useState<OrganizationDialogOpening | null>(null);
  // ONE FAILURE SLOT for both vocabularies, the open dialog's.
  const [failure, setFailure] = useState<OrganizationFailure | LogoFailure | null>(null);
  // WHICH CONTROL the last refusal is about, when the database named one.
  const [refusedField, setRefusedField] = useState<OrganizationField | null>(null);
  /** Which dialog's save landed last, so the card it closed onto says so. */
  const [saved, setSaved] = useState<OrganizationDialog | null>(null);
  // How many times the read has been retried: the key the read's alert is
  // mounted under, so a retry that fails again is announced again.
  const [readAttempts, setReadAttempts] = useState(0);

  // NOT `organizationSnapshotQueryOptions()`, and on purpose. This screen keeps
  // TanStack Query's defaults — no stale bound, so opening it re-reads the row
  // the admin is about to edit — and the factory's five-minute bound would
  // change when that happens. The member screens only read a setting off it.
  const snapshot = useQuery({
    queryKey: ORGANIZATION_SNAPSHOT_KEY,
    queryFn: () => readOrganization(supabaseClient().from(ORGANIZATION_TABLE)),
  });

  const answered = snapshot.data;
  const organization = answered !== undefined && answered.ok ? answered.snapshot : null;
  // A READ THAT THREW is a failed read too (`readFailureOf`): the query
  // function builds the client before `readOrganization` can catch anything,
  // so `SUPABASE_ENVIRONMENT_MISSING` arrives as a query error with no data.
  const readFailure = readFailureOf(snapshot);
  // THE READ'S OWN RETRY. A failed read draws no facts and so no dialog: this
  // is the control that can act on the message's "try again".
  const readRetry = organization === null && readFailure !== null && offersReadRetry(readFailure);
  // DERIVED, never independent (AD-13), and SHARED with the navigation chrome:
  // the signed URL is keyed under the snapshot's key and never fetched when
  // there is no logo.
  const logo = useRenderableLogo(organization === null ? null : organization.logoPath);

  // A RE-READ THAT LOST THE ROW closes the open dialog: the cards it belongs
  // to are gone with the row, and an opening left behind would reopen a
  // dialog nobody asked for once a later read lands. A write in flight keeps
  // its dialog's state until it settles. Focus goes to the read's retry, the
  // one control left on the page.
  useEffect(() => {
    if (organization !== null || opening === null || saving.current) return;

    setOpening(null);
    setFailure(null);
    setRefusedField(null);
  }, [organization, opening]);

  /** Opens one dialog afresh: no refusal and no confirmation carried over. */
  function open(dialog: OrganizationDialog): void {
    if (saving.current || organization === null) return;

    setFailure(null);
    setRefusedField(null);
    setSaved(null);
    openings.current += 1;
    setOpening({ dialog, key: openings.current });
  }

  /** The open dialog's cancel, close button, Escape and backdrop: never while its write is in flight. */
  function close(): void {
    if (saving.current) return;

    const was = opening;

    setOpening(null);
    setFailure(null);
    setRefusedField(null);
    // The browser returns focus to the opener as the dialog closes; this is
    // the net for an opener that re-rendered under it.
    if (was !== null) focusLater([() => openers[was.dialog].current], cardHeading(was.dialog));
  }

  /**
   * Runs one dialog's write, the same way for all five. A refusal keeps the
   * dialog open and focuses the control it names; a landed write closes it,
   * says so on its card and returns focus to its opener.
   */
  async function write(
    dialog: OrganizationDialog,
    send: (row: OrganizationSnapshot) => Promise<DialogOutcome>,
  ): Promise<void> {
    if (organization === null || saving.current) return;

    saving.current = true;
    setFailure(null);
    setRefusedField(null);
    setPending(true);

    // The logo's own vocabulary, so a fault says which write it was.
    const unavailable = dialog === LOGO_DIALOG ? LOGO_UNAVAILABLE : ORGANIZATION_UNAVAILABLE;

    try {
      const outcome = await send(organization);

      if (!outcome.ok) {
        const field = outcome.field ?? null;

        setFailure(outcome.code);
        setRefusedField(field);

        const target = field === null ? undefined : REFUSED_FIELD_IDS[field];

        // THE NAMED FIELD, or else Spremi: it was disabled while the write was
        // in flight, so focus left it, and a keyboard user would otherwise be
        // left on the body of a modal. `focusLater` waits for it to re-enable.
        if (target !== undefined) document.getElementById(target)?.focus();
        else focusLater([byId(ORGANIZATION_DIALOG_SAVE_ID)], cardHeading(dialog));

        return;
      }

      // REFETCHED rather than patched into the cache, so what is on screen
      // after a save is what the database holds. The navigation reads the
      // organization under this very key, so the shell takes a new name or
      // accent from the same refetch. ITS FAILURE IS NOT THE WRITE'S.
      try {
        await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
      } catch (cause) {
        console.error(unavailable, cause);
      }

      setOpening(null);
      setSaved(dialog);
      focusLater([() => openers[dialog].current], cardHeading(dialog));
    } catch (cause) {
      // Everything the services do not already map: the client throwing
      // `SUPABASE_ENVIRONMENT_MISSING` on a build with no environment. Logged
      // as well as surfaced.
      console.error(unavailable, cause);
      setFailure(unavailable);
    } finally {
      // On EVERY path, including the successful one.
      saving.current = false;
      setPending(false);
    }
  }

  /** The name dialog's Spremi: the identity write, the leave year's start as the row holds it. */
  async function saveName(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const field = event.currentTarget.elements.namedItem(ORGANIZATION_NAME_FIELD);

    if (!(field instanceof HTMLInputElement)) return;

    // Read now, not inside the write: the value is what was typed when Spremi
    // was pressed. A blank one is refused by the database, never here.
    const name = field.value;

    await write(NAME_DIALOG, (row) =>
      updateOrganization(supabaseClient().from(ORGANIZATION_TABLE), row.id, {
        name,
        // NOT IN THIS DIALOG: written back as the row holds them, so a save
        // never moves them (FR-7, FR-8, and the leave year's own dialog).
        organizationType: row.organizationType,
        timezone: row.timezone,
        leaveYearStartMonth: row.leaveYearStartMonth,
        leaveYearStartDay: row.leaveYearStartDay,
      }),
    );
  }

  /** The leave year's Spremi: the identity write, the name as the row holds it. */
  async function saveLeaveYear(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const entered = new FormData(event.currentTarget);

    await write(LEAVE_YEAR_DIALOG, (row) =>
      updateOrganization(supabaseClient().from(ORGANIZATION_TABLE), row.id, {
        name: row.name,
        organizationType: row.organizationType,
        timezone: row.timezone,
        leaveYearStartMonth: Number(entered.get(ORGANIZATION_LEAVE_MONTH_FIELD)),
        leaveYearStartDay: Number(entered.get(ORGANIZATION_LEAVE_DAY_FIELD)),
      }),
    );
  }

  /**
   * The logo dialog's Spremi: hands the chosen file to the one module that
   * knows what uploading means. `replaceOrganizationLogo` points the row at
   * the key and then writes the object, in that order and against the
   * SNAPSHOT rather than an id; `logo.test.ts` executes the ordering.
   */
  async function saveLogo(file: Blob): Promise<void> {
    await write(LOGO_DIALOG, (row) =>
      replaceOrganizationLogo(
        supabaseClient().storage.from(ORGANIZATION_LOGO_BUCKET),
        supabaseClient().from(ORGANIZATION_TABLE),
        row,
        file,
      ),
    );
  }

  /**
   * The accent dialog's Spremi: a curated key, or `null` for none, on its own
   * disjoint write. The shell tints itself from the refetch that follows.
   */
  async function saveAccent(accent: BrandAccentKey | null): Promise<void> {
    await write(ACCENT_DIALOG, (row) =>
      updateOrganization(supabaseClient().from(ORGANIZATION_TABLE), row.id, { brandAccent: accent }),
    );
  }

  /**
   * The fire-rank dialog's Spremi, on its own disjoint write. Switching it off
   * hides ranks and positions everywhere and deletes none.
   */
  async function saveFireRanks(uses: boolean): Promise<void> {
    await write(FIRE_RANKS_DIALOG, (row) =>
      updateOrganization(supabaseClient().from(ORGANIZATION_TABLE), row.id, { usesFireRanks: uses }),
    );
  }

  /**
   * Reads the row again after a failed read — the retry the read's message
   * asks for. A second press while the read is in flight does nothing.
   *
   * WHAT HAPPENS TO FOCUS AND TO THE ALERT, in this handler rather than an
   * effect. `flushSync` commits the answer before either is decided: the
   * attempt counter keys the alert, so a retry that fails again REMOUNTS it
   * and `role="alert"` announces it again; and a retry that succeeds unmounts
   * this very button, so focus goes to the first change on the page, the
   * name's, rather than dropping to `<body>`.
   */
  async function retryRead(): Promise<void> {
    if (snapshot.isFetching) return;

    const retried = await snapshot.refetch();

    flushSync(() => {
      setReadAttempts((attempts) => attempts + 1);
    });
    if (retried.data?.ok === true) focusLater([() => nameOpener.current], cardHeading(NAME_DIALOG));
  }

  return {
    snapshot,
    organization,
    readFailure,
    readRetry,
    readAttempts,
    retryRead,
    logo,
    // The dialogs.
    opening,
    openers,
    open,
    close,
    pending,
    failure,
    refusedField: failure === null ? null : refusedField,
    saved,
    saveName,
    saveLeaveYear,
    saveLogo,
    saveAccent,
    saveFireRanks,
  };
}

/** Everything the settings page's cards read, as the hook returns it. */
export type OrganizationSettings = ReturnType<typeof useOrganizationSettings>;
