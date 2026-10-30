import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SET_PASSWORD_PARTS } from '@/features/auth/set-password-screen.fixture';

import {
  attributeOf,
  buttonElements,
  CHROME,
  componentFunction,
  describedByIds,
  finallyBlock,
  GODISNJI,
  HOUR_BAND_EDIT,
  HOUR_BAND_LIST,
  idTokens,
  inputElements,
  KALENDAR,
  labelTargets,
  LEAVE_REQUEST,
  LEAVE_REQUEST_REVIEW,
  MEMBER_CREATE,
  MEMBER_EDIT,
  namedHandler,
  occurrences,
  SCREEN,
  SET_PASSWORD_HOOK,
  SET_PASSWORD_PAGE,
  SET_PASSWORD_SCREEN,
  SETTINGS,
  SHIFT_TYPE_EDIT,
  SHIFT_TYPE_LIST,
  SIGN_IN_FORM,
  SIGN_IN_HOOK,
  SIGN_IN_PAGE,
  source,
  srcRoot,
  submitHandler,
  TEAM_EDIT,
  TEAM_LIST,
} from './source-guards.fixture';

// The sign-in path: the sign-in and set-password screens, their accessible
// names, the authentication seam they reach, and the exit that ends a session.

const SET_PASSWORD_FORM = join(srcRoot, ...SET_PASSWORD_PARTS.form);

/**
 * The screens that own a form, an uncontrolled field and a submit handler.
 *
 * Named separately because the wiring sweeps below apply to exactly these and
 * are meaningless on the other two — and because running them over `SCREEN`
 * alone is how the organization prompt shipped with the identical shape and
 * none of the coverage. The missing-`ref` mutation that reached a browser was
 * caught on one screen and stayed live on the other.
 */
const FORM_SCREENS = [
  // `inFlight` is the name of the ref that guards a second concurrent submit,
  // or `null` for a screen that starts nothing to be in flight. It is carried
  // per entry for the same reason `effect` is: the in-flight sweeps were pinned
  // to the sign-in screen by name — `exchanging.current` written out as a
  // literal — so deleting `setPending(false)` from the settings surface's
  // `finally` left the whole suite green while the identically shaped sign-in
  // screen was protected against exactly that.
  { name: 'the sign-in screen', file: SCREEN, effect: 'signIn(', inFlight: 'exchanging' },
  // STORY 7.8: the set-password step, on the sign-in screen's terms.
  {
    name: 'the set-password screen',
    file: SET_PASSWORD_SCREEN,
    effect: 'savePassword(',
    inFlight: 'exchanging',
  },
  // Story 1.4a's settings surface LEFT THIS LIST in story 7.18: it has no
  // `submit` and no refs any more. Each change is its own dialog, whose save
  // reads its form and hands its write to one runner, `write`, swept by
  // handler below and asserted by name in the settings blocks.
  // Story 1.5b's two. Both await a write and both hold a refusal, so every
  // sweep below applies — and applying them is the point rather than a bonus:
  // the settings surface only gained the in-flight coverage when a second
  // screen with the identical shape shipped without it, and these are the
  // third and fourth.
  //
  // `issuing` rather than `saving` on the create screen, because the two verbs
  // are different: one writes over a row and the other brings an account into
  // existence. The name is carried per entry, so neither sweep can be pinned
  // to one file's spelling.
  {
    name: 'the member create form',
    file: MEMBER_CREATE,
    effect: 'createMember(',
    inFlight: 'issuing',
  },
  { name: 'the member edit form', file: MEMBER_EDIT, effect: 'saveMember(', inFlight: 'saving' },
  // Story 1.7a's two. `creating` on the list, which brings a team into
  // existence, and `writing` on one team, shared by its rename and its archive
  // because the two must never run at once on the same row.
  { name: 'the team list', file: TEAM_LIST, effect: 'createTeam(', inFlight: 'creating' },
  { name: 'the team edit form', file: TEAM_EDIT, effect: 'renameTeam(', inFlight: 'writing' },
  // Story 2.1b's two, on the team screens' terms: `creating` on the list, and
  // `writing` on one band, shared by its save and its removal.
  {
    name: 'the hour band list',
    file: HOUR_BAND_LIST,
    effect: 'createHourBand(',
    inFlight: 'creating',
  },
  {
    name: 'the hour band edit form',
    file: HOUR_BAND_EDIT,
    effect: 'updateHourBand(',
    inFlight: 'writing',
  },
  // Story 2.2b's two, on the same terms: `creating` on the list, and
  // `writing` on one type, shared by its rename, its times, the cancellation
  // and its archive.
  {
    name: 'the shift type list',
    file: SHIFT_TYPE_LIST,
    effect: 'createShiftType(',
    inFlight: 'creating',
  },
  {
    name: 'the shift type edit form',
    file: SHIFT_TYPE_EDIT,
    effect: 'renameShiftType(',
    inFlight: 'writing',
  },
  // Story 3.5b, on the same terms: the admin's override form in the day
  // detail, and `writing` shared by its set and its removal, which must never
  // run at once on the same day.
  // STORY 5.5f: the set now runs the preflight and the erasure check first,
  // under the same latch, and hands the insert itself to `writeSet`, which
  // the erasure confirmation calls too — so the effect read in `submit`,
  // after the default submission is stopped, is that writer's call, and the
  // refused outcome is read off the writer.
  {
    name: 'the Kalendar override form',
    file: KALENDAR,
    effect: 'writeSet(',
    inFlight: 'writing',
    writers: [{ name: 'writeSet', failure: 'setFailure' }],
  },
];

/** The form screens that await something, so something can be in flight. */
const IN_FLIGHT_SCREENS = FORM_SCREENS.filter(
  (screen): screen is typeof screen & { inFlight: string } => screen.inFlight !== null,
);

/**
 * Every AWAITING HANDLER in the application, rather than every screen that owns
 * one — and the distinction is the finding this closes.
 *
 * `submitHandler`, `finallyBlock` and the ref-guard sweep were all pinned to
 * the FIRST match in a file: `function submit(`, the first `finally`, the first
 * `if (…) return;`. That was exactly right while every screen held one awaiting
 * handler, and it went blind the moment one held two — the edit form's password
 * reset awaits, holds its own in-flight ref and its own refused branch, and not
 * one of the three sweeps could see any of it. Deleting `setResetPending(false)`
 * from the reset's `finally` would have left the whole suite green with the
 * confirmation stuck busy for ever on the one surface that can recover an
 * account with no email address.
 *
 * So the sweeps below are driven by HANDLER, each one extracted by name, and a
 * screen contributes as many entries as it has handlers that await.
 *
 * The rotation override review (stories 3.5c, 5.5h) is not listed: its four
 * awaiting handlers share one `begin()` latch in its hook, which these sweeps'
 * per-handler shape cannot read, so its own test below asserts each one's
 * latch and `finally` by name.
 */
const IN_FLIGHT_HANDLERS = [
  ...IN_FLIGHT_SCREENS.map((screen) => ({
    ...screen,
    handler: 'submit',
    pending: 'setPending',
    failure: 'setFailure',
  })),
  {
    // STORY 7.18: the settings surface's five dialogs share one runner, which
    // holds the in-flight ref, the pending flag and the refusal; each save
    // hands it the write it sends.
    name: "the organization settings surface's dialogs",
    file: SETTINGS,
    effect: 'send(organization)',
    inFlight: 'saving',
    handler: 'write',
    pending: 'setPending',
    failure: 'setFailure',
  },
  {
    // THE SECOND AWAITING HANDLER ON THE EDIT FORM. Its flags are its own on
    // purpose: sharing `saving` with the form would make a reset in flight
    // disable Save and the other way round — two unrelated actions blocking
    // each other, neither of which the person asked for.
    name: "the member edit form's password reset",
    file: MEMBER_EDIT,
    effect: 'resetPassword(',
    inFlight: 'resetting',
    handler: 'issue',
    pending: 'setResetPending',
    failure: 'setFailure',
  },
  {
    // STORY 1.6, THE THIRD AWAITING HANDLER ON THE EDIT FORM, with its own
    // flags for the reason the reset has its own.
    name: "the member edit form's status change",
    file: MEMBER_EDIT,
    effect: 'changeMemberStatus(',
    inFlight: 'statusing',
    handler: 'changeStatus',
    // STORY 5.5e: the handler runs the erasure check first and hands the
    // write itself to `writeStatus`, which the erasure dialog's save calls
    // too — so the refused outcome is read off that WRITER.
    writers: [{ name: 'writeStatus', failure: 'setStatusFailure' }],
    pending: 'setStatusPending',
    // ITS OWN REFUSAL STATE, so the date control is described by the status
    // block's alert and never by an unrelated error on the form.
    failure: 'setStatusFailure',
  },
  {
    // STORY 1.7b, THE FOURTH AWAITING HANDLER ON THE EDIT FORM: the team
    // change, with its own flags for the reason the status change has its own.
    // Offered on the caller's own row too, so it must never share a ref with
    // the status block.
    name: "the member edit form's team change",
    file: MEMBER_EDIT,
    effect: 'changeMemberTeam(',
    inFlight: 'teaming',
    handler: 'changeTeam',
    // STORY 5.5e, as the status change: the write is `writeTeam`'s.
    writers: [{ name: 'writeTeam', failure: 'setTeamFailure' }],
    pending: 'setTeamPending',
    failure: 'setTeamFailure',
  },
  {
    // STORY 5.5e: the two cards' erasure dialogs' own saves, which re-derive
    // the check and then write through the card's writer, under the card's
    // own in-flight ref. What each surfaces itself is the thrown path.
    name: "the member edit form's team erasure dialog",
    file: MEMBER_EDIT,
    effect: 'changeMemberTeam(',
    inFlight: 'teaming',
    handler: 'confirmTeamErasures',
    writers: [{ name: 'writeTeam', failure: 'setTeamFailure' }],
    pending: 'setTeamPending',
    failure: 'setTeamFailure',
  },
  {
    name: "the member edit form's status erasure dialog",
    file: MEMBER_EDIT,
    effect: 'changeMemberStatus(',
    inFlight: 'statusing',
    handler: 'confirmStatusErasures',
    writers: [{ name: 'writeStatus', failure: 'setStatusFailure' }],
    pending: 'setStatusPending',
    failure: 'setStatusFailure',
  },
  {
    // STORY 5.1c, THE FIFTH AWAITING HANDLER ON THE EDIT SCREEN: the leave
    // card's save, with its own flags for the reason the team change has its
    // own — a leave write in flight must never disable another card.
    name: "the member edit screen's leave save",
    file: MEMBER_EDIT,
    effect: 'recordLeave(',
    inFlight: 'recording',
    handler: 'save',
    pending: 'setRecordPending',
    failure: 'setLeaveFailure',
  },
  {
    // STORY 5.2b, THE SIXTH AWAITING HANDLER ON THE EDIT SCREEN: the leave
    // card's amend. It shares the form's failure — an amend's refusal stands
    // where a new record's does — but holds its own ref and pending flag.
    name: "the member edit screen's leave amend",
    file: MEMBER_EDIT,
    effect: 'amendLeave(',
    inFlight: 'amending',
    handler: 'amend',
    pending: 'setAmendPending',
    failure: 'setLeaveFailure',
  },
  {
    // STORY 5.2b, THE SEVENTH: a record's removal, from its confirmation, with
    // a failure of its own that stands inside the confirmation.
    name: "the member edit screen's leave removal",
    file: MEMBER_EDIT,
    effect: 'removeLeave(',
    inFlight: 'removing',
    handler: 'remove',
    pending: 'setRemovePending',
    failure: 'setRemoveFailure',
  },
  {
    // STORY 1.7a, the team edit form's second awaiting handler. It shares the
    // rename's `writing` ref on purpose: a rename and an archive of one team
    // in flight together would race on the same row.
    name: "the team edit form's archive",
    file: TEAM_EDIT,
    effect: 'archiveTeam(',
    inFlight: 'writing',
    handler: 'archive',
    pending: 'setPending',
    // ITS OWN REFUSAL STATE, announced inside the archive block, so a refused
    // archive never marks the name field invalid.
    failure: 'setArchiveFailure',
  },
  {
    // STORY 2.1b, the band edit form's second awaiting handler, sharing the
    // save's `writing` ref for the reason the team archive does.
    name: "the hour band edit form's removal",
    file: HOUR_BAND_EDIT,
    effect: 'removeHourBand(',
    inFlight: 'writing',
    handler: 'remove',
    pending: 'setPending',
    // ITS OWN REFUSAL STATE, announced inside the removal block.
    failure: 'setRemoveFailure',
  },
  // STORY 2.2b, the shift type edit form's three further awaiting handlers,
  // all sharing the rename's `writing` ref: two writes on one type in flight
  // together would race on the same row. The times and the cancellation share
  // ONE refusal state, announced in the times block; the archive has its own.
  {
    name: "the shift type edit form's times",
    file: SHIFT_TYPE_EDIT,
    effect: 'correctShiftTypeTimes(',
    inFlight: 'writing',
    handler: 'saveTimes',
    pending: 'setPending',
    failure: 'setTimesFailure',
  },
  {
    name: "the shift type edit form's cancellation",
    file: SHIFT_TYPE_EDIT,
    effect: 'cancelScheduledTimes(',
    inFlight: 'writing',
    handler: 'cancelTimes',
    pending: 'setPending',
    failure: 'setTimesFailure',
  },
  {
    name: "the shift type edit form's archive",
    file: SHIFT_TYPE_EDIT,
    effect: 'archiveShiftType(',
    inFlight: 'writing',
    handler: 'archive',
    pending: 'setPending',
    failure: 'setArchiveFailure',
  },
  {
    // STORY 3.5b, the calendar override form's second awaiting handler: the
    // removal, sharing the set's `writing` ref for the reason the band
    // removal does, with its own refusal announced inside its confirmation.
    // STORY 5.5f: it runs the erasure check first (an override pending
    // review excepted), under the same latch, and hands the removal itself to
    // `writeRemoval`, which the erasure confirmation calls too.
    name: "the Kalendar override form's removal",
    file: KALENDAR,
    effect: 'removeShiftTypeOverride(',
    inFlight: 'writing',
    handler: 'remove',
    writers: [{ name: 'writeRemoval', failure: 'setRemoveFailure' }],
    pending: 'setPending',
    failure: 'setRemoveFailure',
  },
  {
    // STORY 5.5f: the override form's erasure confirmation's own save, which
    // re-derives the check and then writes the set or the removal it was
    // shown for, under the same `writing` latch — named apart from the
    // roster's `confirmErasures`, which shares the file set. Its refused
    // outcomes are the two writers', each swept with its own refusal state.
    name: 'the Kalendar override erasure confirmation',
    file: KALENDAR,
    effect: 'setShiftTypeOverride(',
    inFlight: 'writing',
    handler: 'confirmOverrideErasures',
    writers: [
      { name: 'writeSet', failure: 'setFailure' },
      { name: 'writeRemoval', failure: 'setRemoveFailure' },
    ],
    pending: 'setPending',
    failure: 'setFailure',
  },
  {
    // STORY 3.6b, the calendar roster form's two awaiting handlers: the save
    // and the removal of a change, sharing their own hook's `writing` ref for
    // the reason the override form's do, each with its own refusal state.
    // STORY 5.5b: each now runs the erasure check first, under the same
    // latch, and hands the write itself to `writeSave` / `writeRemoval`,
    // which the erasure confirmation calls too — so the refused outcome is
    // read off that WRITER, and the latch, the finally and the catch off
    // the handler. The save's handler is `submitRoster`, which the form's
    // submit and the refusal's retry both call.
    name: "the Kalendar roster form's save",
    file: KALENDAR,
    effect: 'setRosterOverride(',
    inFlight: 'writing',
    handler: 'submitRoster',
    writers: [{ name: 'writeSave', failure: 'setFailure' }],
    pending: 'setPending',
    failure: 'setFailure',
  },
  {
    name: "the Kalendar roster form's removal",
    file: KALENDAR,
    effect: 'removeRosterOverride(',
    inFlight: 'writing',
    handler: 'removeChange',
    writers: [{ name: 'writeRemoval', failure: 'setRemoveFailure' }],
    pending: 'setPending',
    failure: 'setRemoveFailure',
  },
  {
    // STORY 5.5b, THE THIRD: the erasure confirmation's own save, which
    // re-derives the check and then writes the save or the removal it was
    // shown for, under the same `writing` latch. Its refused outcomes are the
    // two writers', EACH swept with its own refusal state; what it surfaces
    // itself is the thrown path.
    name: "the Kalendar roster erasure confirmation",
    file: KALENDAR,
    effect: 'setRosterOverride(',
    inFlight: 'writing',
    handler: 'confirmErasures',
    writers: [
      { name: 'writeSave', failure: 'setFailure' },
      { name: 'writeRemoval', failure: 'setRemoveFailure' },
    ],
    pending: 'setPending',
    failure: 'setFailure',
  },
  {
    // STORY 9.3: the member's leave request, *Pošalji*, with its own ref; a
    // landed send returns to *Godišnji*, a refusal stays with its alert.
    name: "the leave request form's send",
    file: LEAVE_REQUEST,
    effect: 'sendLeaveRequest(',
    inFlight: 'sending',
    handler: 'send',
    pending: 'setPending',
    failure: 'setFailure',
  },
  {
    // STORY 9.3: *Povuci zahtjev* on a member's pending request, one at a
    // time, its refusal its own, its alert naming the request's range.
    name: "Godišnji's request withdrawal",
    file: GODISNJI,
    effect: 'withdrawLeaveRequest(',
    inFlight: 'withdrawing',
    handler: 'withdraw',
    pending: 'setWithdrawPending',
    failure: 'setRefusal',
  },
  {
    // STORY 9.4: *Odobri* and *Odbij* on a pending request's decision screen,
    // one handler and one ref for both; a landed decision returns to the
    // queue, a refusal stays with its alert.
    name: "the leave request decision screen's decide",
    file: LEAVE_REQUEST_REVIEW,
    effect: 'decideLeaveRequest(',
    inFlight: 'deciding',
    handler: 'decide',
    pending: 'setPending',
    failure: 'setFailure',
  },
];

describe("the leave request form's refusal is about the range it was sent for (story 9.3)", () => {
  it('clears the standing refusal when od or do changes, so no alert or description outlives its range', () => {
    const hook = source(join(srcRoot, 'features', 'leave', 'hooks', 'use-leave-request-form.ts'));
    const change = namedHandler(hook, 'change');

    expect(change, 'change could not be extracted').not.toBe('');
    expect(change, 'editing a date leaves the last refusal standing').toContain('setFailure(null);');
    // And the od field is described by the alert only while one stands.
    expect(source(join(srcRoot, 'features', 'leave', 'components', 'leave-request-form.tsx'))).toMatch(
      /if \(failure !== null && field === LEAVE_FROM_FIELD\) return LEAVE_REQUEST_ERROR_ID;/,
    );
  });
});

describe('the set-password step is one form with nothing to skip it (story 7.8)', () => {
  it('finds its two fields and its three buttons, in the form', () => {
    // The new password and its repeat; the show/hide toggle, `Spremi i
    // nastavi` and `Odjava`. Exactly one submits.
    expect(inputElements(source(SET_PASSWORD_FORM))).toHaveLength(2);
    expect(buttonElements(source(SET_PASSWORD_FORM))).toHaveLength(3);
    expect(inputElements(source(SET_PASSWORD_SCREEN))).toHaveLength(2);
    expect(buttonElements(source(SET_PASSWORD_SCREEN))).toHaveLength(3);
    expect(occurrences(source(SET_PASSWORD_FORM), 'type="submit"')).toBe(1);
  });

  it('never disables its submit, and says new-password to the credential manager', () => {
    const form = source(SET_PASSWORD_FORM);

    expect(form, 'the submit is disabled rather than refusing').not.toMatch(/(?<![-\w])disabled=/);
    expect(occurrences(form, 'autoComplete="new-password"')).toBe(2);
    expect(form).toContain('role="status"');
  });

  it('holds its one hook in the page, and its one exchange in the hook', () => {
    expect(occurrences(source(SET_PASSWORD_PAGE), 'useSetPassword(')).toBe(1);
    expect(source(SET_PASSWORD_HOOK)).toContain('savePassword(');
    expect(occurrences(source(SET_PASSWORD_SCREEN), 'Effect('), 'an effect arrived on the step').toBe(0);
  });
});

describe('the exit ends the session and says so when it cannot', () => {
  it('routes through the supabase module rather than calling the client inline', () => {
    // The same claim the sign-in screen carries, on the other direction of the
    // same seam: the outcome mapping is in a `.ts` module a node test executes,
    // and the chrome's job is to reach it.
    const chrome = source(CHROME);

    for (const required of ["from '@/features/auth/services/sign-out'", 'signOut(', 'supabaseClient()']) {
      expect(chrome, `the chrome no longer reaches ${required}`).toContain(required);
    }
    // A BARE `fetch(`, matched with a boundary rather than as a substring. The
    // other screens use `not.toContain('fetch(')`, which is correct there and
    // wrong here: this component calls `member.refetch()` to re-read the role,
    // and a substring check reports that as a hand-assembled request. The
    // boundary is what keeps the sweep about what it means — a request built in
    // a component rather than routed through `@/lib/supabase/client` and the
    // feature services (`@/features/auth/services/sign-out` among them).
    expect(chrome, 'the chrome assembles a request of its own').not.toMatch(/(?<![\w.])fetch\(/);
    expect(chrome, 'the chrome builds a client of its own').not.toContain('createClient(');
  });

  it('lands the person on a sign-in route, and only once the session actually ended', () => {
    // MUTATION-PROVEN SHAPE, and the mutation is the tempting one: navigating
    // first and reading the outcome after. A refused sign-out leaves the session
    // live, so a navigation on that path lands on a sign-in route the layout's
    // own guard bounces straight back off — which reads as "the button did
    // nothing" rather than as the failure it is.
    const handler = componentFunction(source(CHROME), 'leave');

    expect(handler, 'no sign-out handler to read').not.toBe('');
    expect(handler, 'a successful sign-out does not navigate to a sign-in route').toMatch(
      /navigate\(\{\s*to:\s*'\/prijava'\s*\}\)/,
    );
    expect(handler, 'the refused branch does not put the returned code on screen').toMatch(
      /!outcome\.ok[\s\S]{0,200}?setFailure\(outcome\.code\)/,
    );
    expect(
      handler.indexOf('setFailure(outcome.code)'),
      'the handler navigates before it has read the outcome',
    ).toBeLessThan(handler.indexOf('navigate('));
  });

  it('empties the query cache with the session, which is the shared-device case', () => {
    // `main.tsx` builds ONE `QueryClient` for the page load and a client-side
    // navigation does not reload the page — so without this, `['member-role']`
    // and `['organization']` survive the sign-out and the next person to sign in
    // on the same device sees the previous member's destinations and the
    // previous organization's snapshot until each refetch settles. On a shared
    // shift-work device that is the exact failure the exit exists to prevent.
    //
    // ONLY ON THE REVOKED PATH: clearing after a refused sign-out would throw
    // away a working session's cache for nothing.
    const handler = componentFunction(source(CHROME), 'leave');

    expect(handler, 'the cache outlives the session').toContain('queryClient.clear()');
    expect(
      handler.indexOf('revoked = true'),
      'the cache is cleared before the session is known to have ended',
    ).toBeLessThan(handler.indexOf('queryClient.clear()'));
  });

  it('does not report a failed navigation as a failed sign-out', () => {
    // The session is GONE at that point. Reporting it as a failure tells
    // somebody "Odjava trenutačno nije moguća" while they are already signed
    // out, on a chrome that still looks signed in — the one thing a sign-out
    // control must never say. The console carries the navigation failure; the
    // screen does not contradict the database.
    const handler = componentFunction(source(CHROME), 'leave');

    expect(handler, 'nothing records whether the revocation actually happened').toContain(
      'let revoked = false',
    );
    expect(handler, 'the catch reports every failure as a failed sign-out').toMatch(
      // A block since story 7.3: the refusal also closes the *Više* sheet, in
      // the same render, so the alert it focuses is not behind a modal.
      /if \(!revoked\) \{\s*setMoreOpen\(false\);\s*setFailure\(SIGN_OUT_FAILED\);/,
    );
  });

  it('guards on a ref and clears the in-flight flag on every path', () => {
    // The two defects every handler in this application is swept for: a guard on
    // React state is stale inside a handler already called once this tick, so a
    // double press starts two revocations; and clearing the flag outside a
    // `finally` leaves the control dead after the first refusal, with nothing on
    // screen to say why.
    const handler = componentFunction(source(CHROME), 'leave');
    const block = finallyBlock(source(CHROME));

    expect(handler, 'the sign-out handler has no in-flight guard').toMatch(
      /if\s*\([\s\S]*?leaving\.current[\s\S]*?\)\s*\{?\s*return;/,
    );
    expect(block, 'the sign-out handler has no finally, so a path can leave it in flight').not.toBe(
      '',
    );
    expect(block, 'the finally does not re-enable the control').toContain('setPending(false)');
    expect(block, 'the finally does not clear the in-flight ref').toContain(
      'leaving.current = false',
    );
    expect(handler, 'nothing is surfaced when the call throws outside its own mapping').toMatch(
      /catch[\s\S]{0,400}?setFailure\(/,
    );
  });

  it('logs the cause it cannot render', () => {
    // The catch that swallows `SUPABASE_ENVIRONMENT_MISSING` is how a
    // misconfiguration reads as an outage — the failure `client.ts` exists to
    // prevent and that `prijava.tsx` reintroduced once already.
    expect(source(CHROME), 'the catch reports nothing to the console').toMatch(
      /catch\s*\([\s\S]{0,400}?console\.error\(/,
    );
  });
});

describe('all three sign-in fields carry an accessible name', () => {
  // SOURCE STRUCTURE B7: every claim here is read off the sign-in FORM, the
  // one part that renders the fields, their labels and what they describe.
  // STORY 7.7: three fields — the organization joined the username and the
  // password — so three labels.
  it('gives every input a label bound by htmlFor', () => {
    const screen = source(SIGN_IN_FORM);
    const targets = labelTargets(screen);
    const inputs = inputElements(screen);

    expect(inputs).toHaveLength(3);
    expect(targets).toHaveLength(3);
    for (const input of inputs) {
      const id = attributeOf(input, 'id');

      expect(id, `an <Input> carries no id, so no <Label> can name it`).not.toBeNull();
      expect(targets, `no <Label htmlFor> points at ${String(id)}`).toContain(id);
    }
  });

  it('gives the three fields distinct ids', () => {
    // Two inputs sharing one id satisfies the assertion above — every id is
    // pointed at by some label — while one field goes unnamed and the other is
    // named twice.
    const ids = inputElements(source(SIGN_IN_FORM)).map((input) => attributeOf(input, 'id'));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(null);
  });

  it('points every htmlFor at an input that exists', () => {
    // The other direction. A label whose `htmlFor` names nothing is announced
    // as an orphan and names no control at all.
    const ids = inputElements(source(SIGN_IN_FORM)).map((input) => attributeOf(input, 'id'));

    for (const target of labelTargets(source(SIGN_IN_FORM))) {
      expect(ids, `<Label htmlFor="${target}"> points at no input`).toContain(target);
    }
  });

  /** The password field, found by its credential token: its `type` toggles. */
  function passwordInput(screen: string): string {
    return inputElements(screen).find((input) => attributeOf(input, 'autoComplete') === 'current-password') ?? '';
  }

  /** The organization field, found by its id. */
  function organizationInput(screen: string): string {
    return inputElements(screen).find((input) => attributeOf(input, 'id') === 'organization') ?? '';
  }

  it('binds the refusal to the password field', () => {
    // A refusal that nothing in the tab order passes through, so
    // `aria-describedby` is the only route to a screen-reader user. Asserted as
    // a RESOLVING reference, not merely a present attribute: every id the
    // attribute can name, in either branch, must be an id this screen renders.
    const screen = source(SIGN_IN_FORM);
    const ids = describedByIds(passwordInput(screen));

    expect(ids, 'the password field is not described by the refusal').toContain('sign-in-error');
    for (const id of ids) {
      expect(screen, `no element carries id="${id}"`).toContain(`id="${id}"`);
    }
  });

  it('binds the refusal to all three values, since it concerns all three', () => {
    // STORY 7.7: one message for a wrong organization, username or password.
    // A description reachable from only some of the fields is unreachable from
    // wherever the person actually is. The URL slug's row is not a field, so
    // the refusal is bound to the row's group and to `Promijeni`, the one
    // focusable thing in it (a group's description is not announced while
    // tabbing).
    const screen = source(SIGN_IN_FORM);
    const username = inputElements(screen).find((input) => attributeOf(input, 'autoComplete') === 'username') ?? '';
    const row = /<div\s+role="group"[^>]*>/.exec(screen)?.[0] ?? '';

    for (const [name, element] of [
      ['the organization field', organizationInput(screen)],
      ['the username field', username],
      ['the password field', passwordInput(screen)],
      ["the URL slug's row", row],
      ['Promijeni', buttonElements(screen).find((button) => button.includes('onClick={changeOrganization}')) ?? ''],
    ] as const) {
      expect(element, `${name} was not found`).not.toBe('');
      expect(describedByIds(element), `${name} is not described by the refusal`).toContain('sign-in-error');
    }
    expect(row, "the URL slug's row is not named by the organization label").toContain(
      'aria-labelledby="organization-label"',
    );
    expect(screen, 'the organization label the row names is not rendered').toContain('id="organization-label"');
  });

  it('names the refusal only while the refusal is on the page', () => {
    // The runtime defect a resolving-reference assertion structurally cannot
    // see: `<p id="sign-in-error">` renders only on failure, so a STATIC
    // `aria-describedby="sign-in-error"` described the fields by an element
    // that is absent in the common case. Assistive technology ignores a
    // dangling reference silently, and the source-level lookup above passes
    // either way — the id is in the file.
    //
    // So the shape is asserted, not just the resolution: the error id may only
    // reach the attribute through an expression that branches on the failure.
    const screen = source(SIGN_IN_FORM);
    // VISUAL REFRESH B: the refusal is drawn by the `Notice` primitive, which
    // renders the `<p>`, so the element read here is `<Notice`. Same shape.
    const errorId = /<Notice\s+id="([\w-]+)"\s+role="alert"/.exec(screen)?.[1];

    expect(errorId, 'no role="alert" element to describe the fields by').not.toBeUndefined();

    for (const input of inputElements(screen)) {
      const described = describedByIds(input);

      if (!described.includes(String(errorId))) continue;

      expect(
        attributeOf(input, 'aria-describedby'),
        `a field names ${String(errorId)} unconditionally, so it dangles until something fails`,
      ).toBeNull();
      expect(
        /aria-describedby=\{[^}]*failure[^}]*\}/.test(input),
        'the description is not conditioned on there being a failure',
      ).toBe(true);
    }
  });

  it('keeps the organization hint bound in BOTH branches, since it never goes away', () => {
    // The other polarity of the conditional. Making the whole attribute
    // conditional on a failure would silently drop the hint on how to find the
    // slug — always rendered under the field, and reachable from it only this
    // way — from every screen that has not failed yet, which is all of them.
    const screen = source(SIGN_IN_FORM);
    const branches = [...(/aria-describedby=\{([^}]*)\}/.exec(organizationInput(screen))?.[1] ?? '').matchAll(
      /'([^']*)'/g,
    )].map((found) => idTokens(found[1] ?? ''));

    expect(branches.length, 'the organization description is not a two-branch expression').toBe(2);
    for (const branch of branches) {
      expect(branch, 'a branch drops the organization hint').toContain('organization-hint');
    }
    expect(screen, 'the hint the field names is not rendered').toContain('id="organization-hint"');
  });

  it('lets the credential manager fill the username and the password', () => {
    // `autoComplete` is what makes a saved credential offerable, and the VALUE
    // is what decides it: `off` and `on` are both non-null and neither offers
    // a credential, so a presence check would pass for the shape that breaks
    // every password manager. It is also why the `<form>` element is there at
    // all — outside a form the attribute is ignored.
    //
    // STORY 7.7: the organization field is the one exception, and pinned as
    // such below — it takes a slug, which no credential manager holds.
    const CREDENTIAL_TOKENS = new Set(['username', 'current-password', 'new-password', 'email']);
    const credentials = inputElements(source(SIGN_IN_FORM)).filter(
      (input) => attributeOf(input, 'id') !== 'organization',
    );

    expect(credentials, 'the credential fields were not found').toHaveLength(2);
    for (const input of credentials) {
      const declared = attributeOf(input, 'autoComplete');

      expect(declared, 'an <Input> declares no autoComplete').not.toBeNull();
      expect(
        CREDENTIAL_TOKENS.has(declared ?? ''),
        `autoComplete="${String(declared)}" is not a credential-manager value`,
      ).toBe(true);
    }
    expect(attributeOf(passwordInput(source(SIGN_IN_FORM)), 'autoComplete')).toBe('current-password');
  });

  it('keeps autofill and the phone keyboard out of the organization slug', () => {
    // `off` rather than `organization`: the WHATWG token names the
    // organization's NAME, and this field takes its slug, so autofill would
    // supply a value the slug rule always refuses. A slug is a DNS label, so
    // none of a phone keyboard's text conveniences are wanted either.
    const organization = organizationInput(source(SIGN_IN_FORM));

    expect(attributeOf(organization, 'autoComplete')).toBe('off');
    expect(attributeOf(organization, 'autoCapitalize')).toBe('none');
    expect(attributeOf(organization, 'autoCorrect')).toBe('off');
    expect(organization).toContain('spellCheck={false}');
    expect(organization).toContain('required');
    expect(attributeOf(organization, 'className')).toContain('h-11');
  });

  it('masks the password until the toggle shows it', () => {
    // STORY 7.7: the `type` is an expression on the toggle's state, and that
    // state starts false, so the field opens masked. The toggle is a real
    // `type="button"` (inside a form, a bare button submits), states itself
    // with `aria-pressed` under one constant name, and is 44 px square.
    const form = source(SIGN_IN_FORM);
    const types = inputElements(form).map((input) => attributeOf(input, 'type'));
    const toggle = buttonElements(form).find((button) => button.includes('aria-pressed')) ?? '';

    expect(types).toContain('text');
    expect(passwordInput(form), 'the password type does not follow the toggle').toContain(
      "type={passwordShown ? 'text' : 'password'}",
    );
    expect(source(SIGN_IN_HOOK), 'the password does not open masked').toContain(
      'const [passwordShown, setPasswordShown] = useState(false);',
    );
    expect(toggle, 'no toggle states itself with aria-pressed').not.toBe('');
    expect(toggle).toContain('aria-pressed={passwordShown}');
    expect(toggle).toContain('type="button"');
    expect(toggle).toContain("aria-label={t('auth.passwordShow')}");
    expect(toggle).toContain('onClick={togglePassword}');
    expect(form, 'the toggle does not show its state').toContain(
      '{passwordShown ? <EyeSlash aria-hidden /> : <Eye aria-hidden />}',
    );
    expect(attributeOf(toggle, 'className')).toMatch(/\bh-11\b[\s\S]*\bw-11\b/);
  });

  it('opens the forgotten-password panel in place, as a disclosure', () => {
    // STORY 7.7: a `type="button"` with `aria-expanded` and `aria-controls`,
    // not a link — there is nowhere to go, since an administrator sets every
    // password. The panel is always in the tree and only `hidden` while
    // closed, so `aria-controls` never names an absent id.
    const form = source(SIGN_IN_FORM);
    const trigger = buttonElements(form).find((button) => button.includes('aria-expanded')) ?? '';

    expect(trigger, 'no disclosure states itself with aria-expanded').not.toBe('');
    expect(trigger).toContain('aria-expanded={forgotOpen}');
    expect(trigger).toContain('aria-controls="forgot-password"');
    expect(trigger).toContain('type="button"');
    expect(form, 'the panel the disclosure controls is not always rendered').toMatch(
      /<Callout id="forgot-password" hidden=\{!forgotOpen\}>/,
    );
    expect(source(SIGN_IN_HOOK), 'the panel does not open closed').toContain(
      'const [forgotOpen, setForgotOpen] = useState(false);',
    );
  });

  it("swaps the URL slug's row for the field with Promijeni, and focuses it", () => {
    // STORY 7.7: the row shows the slug as text, not an input, and
    // `Promijeni` (named `Promijeni organizaciju`) swaps in the field. The URL
    // does not change, so the hook navigates nowhere to do it: it commits the
    // field first and then focuses it.
    const form = source(SIGN_IN_FORM);
    const change = buttonElements(form).find((button) => button.includes('onClick={changeOrganization}')) ?? '';
    const handler = /function changeOrganization\(\)[\s\S]*?\n {2}\}/.exec(source(SIGN_IN_HOOK))?.[0] ?? '';

    expect(change, 'no button swaps the row for the field').not.toBe('');
    expect(change).toContain('type="button"');
    expect(change).toContain("aria-label={t('auth.organization.changeLabel')}");
    // A group is not focusable, so its description is not announced while
    // tabbing: the button carries the refusal too.
    expect(change).toContain("aria-describedby={failure === null ? undefined : 'sign-in-error'}");
    expect(handler, 'the swap is not committed before the focus').toMatch(
      /flushSync\([\s\S]*setEditing\(true\)[\s\S]*organizationField\.current\?\.focus\(\)/,
    );
    expect(handler, 'the swap navigates').not.toContain('navigate');
  });

  it('never disables the submit button, only marks it', () => {
    // `disabled` on the button somebody has just pressed drops keyboard focus
    // to `<body>`. Nothing on the form carries it. STORY 8.3a: the write
    // gate's `gate.disabled` is a VALUE read into `aria-disabled`, never the
    // attribute, so a member access is not one.
    expect(source(SIGN_IN_FORM)).not.toMatch(/(?<![\w.-])disabled[=\s>{]/);
  });

  it('keeps the phone keyboard out of an admin-issued username', () => {
    const username = inputElements(source(SIGN_IN_FORM)).find(
      (input) => attributeOf(input, 'autoComplete') === 'username',
    );

    expect(attributeOf(username ?? '', 'autoCapitalize')).toBe('none');
    expect(attributeOf(username ?? '', 'autoCorrect')).toBe('off');
    expect(username).toContain('spellCheck={false}');
  });
});

describe('the screen reaches the authentication seam rather than faking one', () => {
  /**
   * THE INVERSE of story 1.1d's block, which asserted this screen was inert and
   * named `supabase`, `fetch(`, `useState` and `localStorage` as offences. It
   * was self-labelled "until story 1.3 wires it", and this is that story — so
   * the claim is narrowed to the new truth rather than deleted, and the tokens
   * are not renamed to evade it. What is still refused is the shape those
   * tokens were standing in for: a request assembled inline, an address built
   * in a screen, and a submission that leaks a password into the URL.
   */

  it('still keeps a typed password out of the URL, the history and the CDN log', () => {
    // UNCHANGED and still load-bearing, precisely BECAUSE there is a handler
    // now: if the handler ever does not run — a bundle that failed to load, a
    // script error — the browser submits the form itself, and the default
    // method is GET.
    // SOURCE STRUCTURE B7: in the form, the part that renders the `<form>`.
    const form = /<form\b(?:=>|[^>])*>/.exec(source(SIGN_IN_FORM))?.[0] ?? '';

    expect(form, 'no <form> opening tag in the sign-in form').not.toBe('');
    expect(form, 'the <form> opening tag is not method="post"').toMatch(/\smethod="post"/);
    expect(occurrences(source(SCREEN), '<form'), 'a second form arrived on the sign-in screen').toBe(1);
  });

  it.each(FORM_SCREENS)("routes $name's own onSubmit into its submit handler", ({ file }) => {
    // Scoped to the `<form>` element rather than searched for anywhere in the
    // file: a handler defined and never bound is a screen whose button does
    // nothing, which is exactly what this file used to assert was correct.
    //
    // OVER BOTH FORM SCREENS. Reading only the sign-in screen left the
    // organization prompt — same form, same handler shape — covered by nothing.
    const screen = source(file);
    const formBlock = /<form\b[\s\S]*?<\/form>/.exec(screen)?.[0];

    expect(formBlock, 'no <form>...</form> element on the screen').not.toBeUndefined();
    expect(screen, 'the submit handler is gone').toMatch(/function submit\(/);
    // `\bsubmit\b` rather than `submit(`: one screen binds an arrow that calls
    // it, the other binds the function itself, and both are correct bindings.
    expect(
      formBlock,
      "the form's onSubmit does not reach the screen's submit handler",
    ).toMatch(/onSubmit=\{[\s\S]{0,160}?\bsubmit\b/);
  });

  it.each(FORM_SCREENS)('prevents the default submission first on $name', ({ file, effect }) => {
    // `preventDefault` is no longer the whole handler — it is the first thing
    // the real one does, because a POST to a static host is a 405 that discards
    // every entered value, the opposite of UX-DR34.
    //
    // The old assertion required an inline arrow whose body contained no `}`,
    // which no real handler can satisfy. This asserts the ORDER instead:
    // prevention inside the handler, before the screen's own effect.
    // READ INSIDE THE HANDLER, not across the file: on a screen that is a file
    // set, a `preventDefault()` in another file would otherwise satisfy it.
    const handler = submitHandler(source(file));

    expect(handler, 'the handler does not prevent the default submission').toContain(
      'preventDefault()',
    );
    expect(handler, `${effect} is not called from the submit handler`).toContain(effect);
    expect(
      handler.indexOf('preventDefault()'),
      `${effect} runs before the default submission is stopped`,
    ).toBeLessThan(handler.indexOf(effect));
  });

  it('exchanges credentials through the supabase modules, not inline', () => {
    // The positive half of the frozen boundary's replacement. `supabase` is no
    // longer forbidden here — it is REQUIRED, and required as an import of the
    // two modules that own the client and the mapping.
    // SOURCE STRUCTURE B7: in the hook, the one part that exchanges.
    const screen = source(SIGN_IN_HOOK);

    for (const required of [
      "from '@/lib/supabase/client'",
      "from '@/features/auth/services/sign-in'",
      'supabaseClient()',
      'signIn(',
    ]) {
      expect(screen, `the sign-in screen no longer reaches ${required}`).toContain(required);
    }
  });

  it('builds no request and no address of its own', () => {
    // What the forbidden-token sweep was really protecting. A screen that
    // assembled the AD-12 address itself would put the `@`, the slug and the
    // reserved domain in a file where `literal-sweep.test.ts` forbids every literal —
    // and would be a second place for the expression `seed.sql` already holds.
    // SOURCE STRUCTURE B7: PER PART, so no part of the set reaches for one.
    for (const part of SCREEN) {
      for (const forbidden of ['fetch(', 'shift.invalid', 'localStorage', 'createClient(']) {
        expect(source(part), `${part} reaches for ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it.each(FORM_SCREENS)('attaches a ref to every field the handler reads on $name', ({ file }) => {
    // MUTATION-PROVEN GAP, and the mutation was the first draft of this screen.
    // The two `useRef` calls were declared and read in the handler but never
    // put on the `<Input>` elements, so `current` stayed null, the handler
    // returned at its own guard, and the button did nothing at all — with the
    // whole suite green, `pnpm lint` clean and `pnpm typecheck` clean, because
    // the refs ARE used, just not attached.
    //
    // Asserted as a resolving pair rather than as a present attribute: the ref
    // an input names has to be the one the handler dereferences, or this passes
    // for a screen wired to two objects nobody reads.
    const screen = source(file);
    const attached = inputElements(screen).map((input) => /ref=\{(\w+)\}/.exec(input)?.[1] ?? null);

    expect(attached.length, 'no <Input> on a screen that has a form').toBeGreaterThan(0);

    expect(attached, 'an <Input> carries no ref, so the handler cannot read it').not.toContain(null);
    expect(new Set(attached).size, 'two fields share one ref').toBe(attached.length);
    for (const name of attached) {
      expect(screen, `ref ${String(name)} is declared on an input and never created`).toContain(
        `const ${String(name)} = useRef`,
      );
      expect(screen, `ref ${String(name)} is attached and never read`).toContain(
        `${String(name)}.current`,
      );
    }
  });

  it.each(FORM_SCREENS)('guards on $name against a ref that is still null', ({ file }) => {
    // The other half: the handler must not assume the element is there. The
    // guard is what turns the mutation above into a no-op rather than a crash,
    // which is also why the assertion above is needed to notice it happening.
    // Inside the submit handler's own early return, not anywhere in the file
    // set: another handler's guard is not this one's.
    const guard = /if\s*\([\s\S]*?\)\s*\{?\s*return;/.exec(submitHandler(source(file)))?.[0] ?? '';

    expect(guard, 'the submit handler has no early return').not.toBe('');
    expect(guard, 'the early return does not check for a null ref').toContain('=== null');
  });

  it('has an in-flight screen to sweep at all', () => {
    // NON-VACUITY for the three sweeps below, which run over `IN_FLIGHT_SCREENS`
    // rather than over `FORM_SCREENS`. A `null` written into every entry would
    // make all three loops assert nothing while still reading as coverage —
    // which is the shape the per-screen sweeps were introduced to end.
    // FOUR SINCE STORY 1.5b. Two screens with the identical await-and-refuse
    // shape joined, and the whole reason these sweeps are driven off a list is
    // that the settings surface was covered by none of them until a second
    // screen made the gap obvious.
    // EIGHT SINCE STORY 2.1b: the two hour band screens.
    // TEN SINCE STORY 2.2b: the two shift type screens.
    // ELEVEN SINCE STORY 3.5b: the calendar's override form.
    // TWELVE SINCE STORY 7.8: the set-password step.
    // ELEVEN SINCE STORY 7.18: the settings surface's dialogs are swept by
    // their runner, below, rather than as a form screen.
    expect(IN_FLIGHT_SCREENS.length, 'no form screen declares an in-flight ref').toBe(11);
    expect(
      IN_FLIGHT_SCREENS.map((screen) => screen.inFlight).sort(),
      'the in-flight ref names drifted from the screens that hold them',
    ).toEqual([
      'creating',
      'creating',
      'creating',
      'exchanging',
      'exchanging',
      'issuing',
      'saving',
      'writing',
      'writing',
      'writing',
      'writing',
    ]);
    // MORE HANDLERS THAN SCREENS, and the mismatch is the point (it began as
    // nine over six): the member edit form owns four awaiting handlers, the
    // team and band edit forms two each and the shift type edit form four, and
    // while these sweeps counted SCREENS the extra ones were read by none of
    // them. A list that silently fell back
    // to one entry per file would make every sweep below miss exactly the
    // handler that was added last.
    // TEN SINCE STORY 1.7b: the member edit form's fourth, the team change.
    // THIRTEEN SINCE STORY 2.1b: the band list's add, and the band edit
    // form's save and its removal, which is its own handler.
    // EIGHTEEN SINCE STORY 2.2b: the shift type list's add, and the shift
    // type edit form's rename, times, cancellation and archive.
    // TWENTY SINCE STORY 3.5b: the calendar override form's set and removal.
    // TWENTY-TWO SINCE STORY 3.6b: the calendar roster form's save and removal.
    // TWENTY-THREE SINCE STORY 5.1c: the member edit screen's fifth, the leave
    // card's save.
    // TWENTY-FIVE SINCE STORY 5.2b: its sixth and seventh, the leave card's
    // amend and a record's removal.
    // TWENTY-SIX SINCE STORY 5.5b: the calendar roster form's erasure
    // confirmation; its save's handler is `submitRoster` now.
    // TWENTY-EIGHT SINCE STORY 5.5e: the member edit form's team and status
    // erasure dialogs' own saves.
    // TWENTY-NINE SINCE STORY 5.5f: the calendar override form's erasure
    // confirmation.
    // THIRTY SINCE STORY 7.8: the set-password step's submit.
    // STILL THIRTY SINCE STORY 7.18: the settings surface's `submit` became
    // the dialogs' one runner, `write`.
    // THIRTY-THREE SINCE STORY 9.4: the leave request decision's decide.
    expect(IN_FLIGHT_HANDLERS.length, 'an awaiting handler is swept by nothing').toBe(33);
    expect(
      IN_FLIGHT_HANDLERS.map((entry) => `${entry.handler}/${entry.inFlight}`).sort(),
      'the in-flight handler names drifted from the handlers that hold them',
    ).toEqual([
      'amend/amending',
      'archive/writing',
      'archive/writing',
      'cancelTimes/writing',
      'changeStatus/statusing',
      'changeTeam/teaming',
      'confirmErasures/writing',
      'confirmOverrideErasures/writing',
      'confirmStatusErasures/statusing',
      'confirmTeamErasures/teaming',
      'decide/deciding',
      'issue/resetting',
      'remove/removing',
      'remove/writing',
      'remove/writing',
      'removeChange/writing',
      'save/recording',
      'saveTimes/writing',
      'send/sending',
      'submit/creating',
      'submit/creating',
      'submit/creating',
      'submit/exchanging',
      'submit/exchanging',
      'submit/issuing',
      'submit/saving',
      'submit/writing',
      'submit/writing',
      'submit/writing',
      'submit/writing',
      'submitRoster/writing',
      'withdraw/withdrawing',
      'write/saving',
    ]);
    // NON-VACUITY ON THE EXTRACTOR ITSELF. A `namedHandler` that answered `''`
    // for every name would make all three sweeps below assert nothing at all.
    for (const entry of IN_FLIGHT_HANDLERS) {
      expect(
        namedHandler(source(entry.file), entry.handler).length,
        `${entry.handler} on ${entry.file} could not be extracted`,
      ).toBeGreaterThan(80);
    }
  });

  it.each(IN_FLIGHT_HANDLERS.filter((entry) => entry.file === MEMBER_EDIT))(
    'calls its effect only from inside its own handler on $name',
    (entry) => {
      const { file, effect } = entry;
      // STORY 5.5e: a handler that hands its write to a writer is read
      // through it — the effect is called from the writer, and the handler
      // calls the writer.
      const writer = 'writers' in entry ? entry.writers[0]?.name : undefined;
      const named = writer ?? entry.handler;

      if (writer !== undefined) {
        expect(namedHandler(source(file), entry.handler), `${entry.handler} never calls ${writer}`).toContain(`${writer}(`);
      }
      // MUTATION-PROVEN GAP, found by B1's implementer: a `changeMemberStatus(`
      // call placed outside `changeStatus` passed every test here, because the
      // sweeps below read INSIDE each handler and say nothing about the rest
      // of the file set. A call outside it skips the in-flight ref, the pending
      // flag and the refusal the handler owns.
      //
      // WHAT THIS CATCHES, and no more: across the edit screen's whole set, the
      // effect's NAME appears once in an import and once inside its handler,
      // where it is called, and the import does not rename it. That refuses a
      // second call, and a reference that could become one — an alias, a
      // `mutationFn: name`, `name.call(…)`, `name<T>(…)`. It does not follow a
      // value handed on from inside the handler, and it reads names, not types.
      const screen = source(file);
      const scoped = namedHandler(screen, named);
      const name = effect.slice(0, -1);
      const bare = new RegExp(`\\b${name}\\b`, 'g');
      const imports = (screen.match(/import\s*(?:type\s*)?\{[\s\S]*?\}\s*from\s*'[^']*';/g) ?? []).join(
        '\n',
      );

      expect(scoped, `${named} could not be extracted, so nothing below is asserted`).not.toBe('');
      expect(occurrences(scoped, effect), `${effect} is not called from ${named}`).toBe(1);
      expect(occurrences(screen, effect), `${effect} is called outside ${named}`).toBe(1);
      expect(imports.match(bare) ?? [], `${name} is not imported exactly once`).toHaveLength(1);
      expect(imports, `${name} is imported under another name`).not.toMatch(
        new RegExp(`\\b${name}\\s+as\\b`),
      );
      expect(scoped.match(bare) ?? [], `${name} is referenced again inside ${named}`).toHaveLength(1);
      expect(
        screen.match(bare) ?? [],
        `${name} is referenced outside its import and ${named}`,
      ).toHaveLength(2);
    },
  );

  it.each(IN_FLIGHT_HANDLERS)(
    'clears the in-flight flag on every path on $name, and guards on a ref not on state',
    ({ file, handler: named, failure }) => {
      // TWO defects in one shape. `pending` was cleared only on the failure
      // branch, so the moment the awaited call stopped resolving the button was
      // disabled forever with nothing on screen to say why — `finally` is what
      // makes that unreachable. And the guard reads a REF: state is stale inside
      // a handler already called once this tick, so a second submit (double
      // click, Enter as the click lands) fired a second concurrent call.
      //
      // OVER EVERY SCREEN THAT AWAITS SOMETHING, since the 1.4a review. Pinned
      // to the sign-in screen this protected one of the two files with the
      // identical shape, and deleting the settings surface's `finally` was free.
      // SCOPED TO THE HANDLER, since the edit form grew a second one. Read off
      // the whole file, all three of these were satisfied by whichever handler
      // came first and said nothing whatsoever about the other.
      const scoped = namedHandler(source(file), named);

      expect(scoped, `${named} could not be extracted, so nothing below is asserted`).not.toBe('');
      expect(scoped, 'this handler has no finally, so a path can leave it in flight').toMatch(
        /\}\s*finally\s*\{/,
      );

      const guard = /if\s*\([\s\S]*?\)\s*\{?\s*return;/.exec(scoped)?.[0] ?? '';

      expect(guard, 'the in-flight guard reads React state, which is stale within a tick').toMatch(
        /\.current\b/,
      );
      expect(scoped, 'nothing is surfaced when the call throws outside its own mapping').toMatch(
        new RegExp(`catch[\\s\\S]{0,400}?${failure}\\(`),
      );
    },
  );

  it.each(IN_FLIGHT_HANDLERS)('surfaces the refused outcome code on $name', (entry) => {
    // STORY 5.5b: where a handler hands its writes to writers, each outcome is
    // its writer's to surface, into that writer's own refusal state — and a
    // handler with two writers is swept for both, each called from it.
    const writers = 'writers' in entry ? entry.writers : [{ name: entry.handler, failure: entry.failure }];

    for (const { name, failure } of writers) {
      if (name !== entry.handler) {
        expect(namedHandler(source(entry.file), entry.handler), `${entry.handler} never calls ${name}`).toContain(`${name}(`);
      }
      refusedOutcomeSurfaced(entry.file, name, failure);
    }
  });

  function refusedOutcomeSurfaced(file: Parameters<typeof source>[0], named: string, failure: string): void {
    // MUTATION-PROVEN GAP, found by the 1.4a review: deleting
    // `setFailure(outcome.code)` from the settings surface's handler left the
    // whole suite green, and a refused save then looked exactly like a saved
    // one — the button re-enabled, the values still there, nothing said. The
    // `catch` assertion above covers the THROWN path only, and a policy refusal
    // never throws.
    const handler = namedHandler(source(file), named);

    expect(handler, 'no handler to read').not.toBe('');
    // `outcome.code` OR `outcome.refusal`, because story 1.5b's outcome carries
    // one more fact than a code: whether the ordinary fields were written
    // before the rename was refused. A flat code there would discard the half
    // of the answer that says four values really are in the database.
    // The refusal may be WRAPPED on its way to the state — the edit screen
    // scopes it to the member it was raised about, so a refusal from one row
    // cannot stand over another's form — but what reaches `setFailure` has to
    // be the outcome's own, not a constant the handler invented.
    expect(
      handler,
      'the refused branch does not put the returned code on screen',
    ).toMatch(
      new RegExp(
        // STORY 2.2b's add hands the outcome to `createdOutcomeOf` — the branch
        // is a pure function the node suite executes (`features/shift-types/services/write.test.ts`)
        // — and the refusal it derives from the outcome is what reaches state.
        `outcome\\.ok[\\s\\S]{0,200}?${failure}\\([\\s\\S]{0,80}?outcome\\.(?:code|refusal)` +
          `|const next = createdOutcomeOf\\(outcome\\);[\\s\\S]{0,120}?${failure}\\(next\\.failure\\)`,
      ),
    );
  }

  it('keeps every entered value by never controlling the fields', () => {
    // UX-DR34: a refused save keeps every entered value. Uncontrolled inputs
    // keep what was typed because nothing re-renders them away — so the state
    // this screen holds is the FAILURE, never the credentials. A `value={…}` on
    // any field is the shape that loses them on the render that shows the
    // error. STORY 7.7: three fields, and the organization field's prefill is
    // a `defaultValue`, which an uncontrolled field keeps.
    // SOURCE STRUCTURE B7: in the form, the part that renders the fields.
    const screen = source(SIGN_IN_FORM);

    expect(inputElements(screen), 'the form renders no field to read').toHaveLength(3);
    for (const input of inputElements(screen)) {
      expect(attributeOf(input, 'value'), 'a credential field is controlled').toBeNull();
      expect(input, 'a credential field is controlled').not.toContain('value={');
    }
  });

  it('delegates the failure-to-message pairing rather than branching on it', () => {
    // The screen used to hold `failure === SIGN_IN_REFUSED ? credentials :
    // unavailable`, and nothing could run it: swapping the branches passed
    // every assertion here while a wrong password reported a service outage.
    // The mapping is executed in `sign-in.test.ts` now, and what is left to
    // assert is that the screen ROUTES through it and holds no branch of its
    // own over the codes.
    // SOURCE STRUCTURE B7: the mapping in the form, which renders the refusal,
    // and no branch over the codes in any part.
    expect(source(SIGN_IN_FORM), 'the screen no longer renders its message through the mapping').toContain(
      't(signInMessageKey(',
    );
    for (const part of SCREEN) {
      for (const key of ['auth.error.credentials', 'auth.error.unavailable']) {
        expect(source(part), `${key} is branched on in ${part} again`).not.toContain(key);
      }
    }
  });

  it('signs in against the URL slug or the field, and not one of its own', () => {
    // Nothing pinned this. A hard-coded slug, or `slug` dropped from the
    // credentials object, passed every test in the suite — and would send every
    // sign-in to one tenant, or to none.
    // SOURCE STRUCTURE B7: the page reads the slug and hands it to the hook,
    // and the hook hands `signIn` either that slug or what the organization
    // field holds (story 7.7). NOT STRICT, because one component serves both
    // routes and bare `/prijava` has no slug.
    expect(source(SIGN_IN_PAGE), 'the screen never reads the slug from the route params').toMatch(
      /const \{\s*slug\s*\}\s*=\s*useParams\(\{\s*strict:\s*false\s*\}\)/,
    );
    expect(source(SIGN_IN_PAGE), 'the page does not hand the slug to the hook').toContain('useSignIn(slug)');
    expect(occurrences(source(SCREEN), 'useParams('), 'a part reads the route params besides the page').toBe(1);

    const hook = source(SIGN_IN_HOOK);
    const call = /signIn\(([\s\S]*?)\}\)/.exec(hook)?.[1];

    expect(call, 'the screen does not call signIn at all').not.toBeUndefined();
    expect(call, 'the organization is not among the credentials handed to signIn').toMatch(
      /(?:^|[\s,{])slug:\s*organization\s*,/,
    );
    expect(hook, 'the organization is not the URL slug or the field').toMatch(
      /const organization = organizationEditable \? organizationField\.current\?\.value : shownSlug;/,
    );
    // The URL slug NORMALIZED before it is shown, prefilled or sent, so
    // `/prijava/DVD-Demo` shows what is sent and remembered.
    expect(hook, 'the URL slug is shown as typed rather than as sent').toContain(
      'const shownSlug = slug === undefined ? undefined : (organizationDestination(slug) ?? slug);',
    );
    expect(hook, 'the Promijeni prefill is not the normalized slug').toContain(
      'organizationDefault: shownSlug ?? remembered,',
    );
    expect(source(SIGN_IN_FORM), 'the row shows the slug as typed').toContain('{shownSlug}</span>');
    expect(hook, 'the field does not stand in for the row once Promijeni is pressed').toContain(
      'const organizationEditable = slug === undefined || editing;',
    );
  });

  it('re-masks the password before the exchange', () => {
    // STORY 7.7: committed before anything is asked, so a refusal never
    // focuses a password shown as plain text, and a credential manager sees a
    // `type="password"` field on the submit.
    const handler = submitHandler(source(SIGN_IN_HOOK));

    expect(handler, 'the password is not re-masked before the exchange').toMatch(
      /flushSync\(\(\) => \{\s*setPasswordShown\(false\);\s*\}\);[\s\S]*?exchanging\.current = true;[\s\S]*?signIn\(/,
    );
  });

  it('says the organization was remembered only while the field still holds it', () => {
    // STORY 7.7: once the person edits the prefill, `Zapamćeno na ovom
    // uređaju.` is no longer true. Tracked from the field's own input event,
    // not an effect (the effect count above stays zero).
    const hook = source(SIGN_IN_HOOK);

    expect(hook).toContain('setStillRemembered(event.currentTarget.value === remembered);');
    expect(hook, 'the hint ignores an edited field').toMatch(/rememberedHere:[\s\S]{0,160}?&& stillRemembered,/);
    expect(source(SIGN_IN_FORM), 'the field does not report its edits').toContain('onInput={organizationInput}');
    expect(source(SIGN_IN_FORM), 'the field has no example of a slug').toContain(
      "placeholder={t('auth.organization.placeholder')}",
    );
  });

  it('remembers the organization only after a successful sign-in', () => {
    // STORY 7.7: written after `!outcome.ok` has returned, so a refused value
    // — a typo — is never remembered, and through the service, which stores
    // only the normalized slug. The parts never name `localStorage` (the
    // sweep above); the service is the one place it is touched.
    const handler = submitHandler(source(SIGN_IN_HOOK));

    expect(occurrences(handler, 'lastOrganization.remember('), 'not exactly one write').toBe(1);
    expect(handler, 'the write is not after the refusal returns').toMatch(
      /!outcome\.ok\)\s*\{[\s\S]*?return;\s*\}[\s\S]*?lastOrganization\.remember\(lastOrganization\.deviceStorage\(\), organization\)/,
    );
  });

  it('lands a signed-in visitor on the validated return target, and nowhere else', () => {
    // MUTATION-PROVEN GAP. Nothing in this repository read a `navigate(` call:
    // a grep across every test file returned zero matches, so `to: '/prijava'`
    // here passed the entire suite while a correct sign-in established a
    // session and then dropped the person back on bare `/prijava` — which,
    // with no signed-in guard on that route then, renders as though nothing
    // happened. The story's first acceptance criterion was verified only by
    // somebody remembering to run the manual browser check.
    // SOURCE STRUCTURE B7: inside the hook's own submit.
    //
    // SINCE THE SIGN-IN FIX the landing is the deep link the signed-out
    // redirect carried, and only ever through the validator: a raw
    // `navigate({ href: povratak })` would be an open redirect, and `to: '/'`
    // would drop the destination the visitor asked for. `returnTargetOf` falls
    // back to `/` itself, which `return-target.test.ts` executes.
    const hook = source(SIGN_IN_HOOK);
    const handler = submitHandler(hook);

    expect(handler, 'the sign-in screen has no submit handler').not.toBe('');
    expect(occurrences(handler, 'navigate('), 'a sign-in navigates more than once').toBe(1);
    expect(handler, 'a successful sign-in does not follow the validated target').toMatch(
      /navigate\(\{\s*href:\s*returnTargetOf\(povratak,\s*knownPathOf\(router\)\),\s*replace:\s*true\s*\}\)/,
    );
    expect(hook, 'the return target is not read off the route').toMatch(
      /const \{\s*povratak\s*\}\s*=\s*useSearch\(/,
    );
  });

  it('keeps focus on a pending submit, and moves it on a refusal', () => {
    // `disabled={pending}` took the button a person had just pressed out of the
    // tab order and dropped keyboard focus to `<body>` mid-flow. The button is
    // `aria-disabled` now and the in-flight ref refuses the second submit; a
    // refusal moves focus to the password field the message describes, in the
    // handler, on both the refused and the thrown path.
    // STORY 7.7: the submit button is one of four now, so it is found by type.
    const button = buttonElements(source(SIGN_IN_FORM)).find((found) => found.includes('type="submit"')) ?? '';
    const handler = submitHandler(source(SIGN_IN_HOOK));

    expect(button, 'the submit button is disabled natively, which drops focus').not.toMatch(
      /\sdisabled=/,
    );
    // STORY 8.3a: offline it is `aria-disabled` too, and names the offline note.
    expect(button, 'the pending state is not stated').toContain('aria-disabled={gate.disabled || pending}');
    expect(button, 'the offline gate does not name its note').toContain('aria-describedby={gate.describedBy()}');
    expect(button, 'the pending state is not stated as busy').toContain('aria-busy={pending}');
    expect(source(SIGN_IN_FORM), 'the button does not say it is signing in').toContain(
      "{pending ? t('auth.pending') : t('auth.submit')}",
    );
    // FOCUS AFTER THE COMMIT: the refusal is rendered through `flushSync`
    // first, so the field is announced with the error it now points at.
    expect(handler, 'a refused sign-in leaves focus where it was, or focuses before the commit').toMatch(
      /!outcome\.ok\)\s*\{[\s\S]{0,400}?flushSync\(\(\) => \{\s*setFailure\(outcome\.code\);\s*\}\);\s*password\.focus\(\);\s*return;/,
    );
    expect(handler, 'an unavailable sign-in leaves focus where it was, or focuses before the commit').toMatch(
      /flushSync\(\(\) => \{\s*setFailure\(SIGN_IN_UNAVAILABLE\);\s*\}\);\s*password\.focus\(\);/,
    );
  });

  it.each(IN_FLIGHT_HANDLERS)(
    'clears the in-flight state inside the finally on $name, not merely near one',
    ({ file, inFlight, handler: named, pending }) => {
      // The assertion this replaces matched `/\}\s*finally\s*\{/` against the
      // whole file, which is the existence of the keyword and nothing about what
      // it does. Deleting `setPending(false)` from inside it passed — and left
      // `pending` true after the first wrong password, so `disabled={pending}`
      // kept the button dead on the most common error path, with the entered
      // values still on screen and no way to retry.
      //
      // The ref NAME comes from the screen's own entry since the 1.4a review.
      // Hard-coded as `exchanging.current = false` this could only ever be true
      // of one file, so the settings surface's `saving` ref was swept by nothing.
      // HANDED ONE HANDLER, not the file. `finallyBlock` returns the FIRST
      // `finally` it finds, so the edit form's second awaiting handler — its
      // password reset — was covered by nothing for as long as this read the
      // whole screen: deleting `setResetPending(false)` left the confirmation
      // stuck busy for ever with the suite green.
      const block = finallyBlock(namedHandler(source(file), named));

      expect(block, `${named} has no finally, so a path can leave it in flight`).not.toBe('');
      // THE SETTER NAME COMES FROM THE ENTRY, for the reason the ref name does:
      // two handlers on one screen hold two different pending flags, and a
      // hard-coded `setPending` is true of one of them by accident.
      expect(block, 'the finally does not re-enable the control').toContain(`${pending}(false)`);
      expect(block, 'the finally does not clear the in-flight ref').toContain(
        `${inFlight}.current = false`,
      );
    },
  );

  it('logs the cause it cannot render', () => {
    // The catch swallowed `SUPABASE_ENVIRONMENT_MISSING` whole while its own
    // comment claimed "the console still carries the stable code". Nothing
    // wrote to the console, so a deployment with no environment showed a
    // working-looking form saying "try again" forever and left no trace
    // anywhere — the misconfiguration-as-outage failure `client.ts` exists to
    // prevent, reintroduced two files downstream.
    // SOURCE STRUCTURE B7: in the hook's submit, with the stable code, and the
    // code is what the refusal falls back to.
    const handler = submitHandler(source(SIGN_IN_HOOK));

    expect(handler, 'the catch reports nothing to the console').toMatch(
      /catch\s*\([\s\S]{0,600}?console\.error\(SIGN_IN_UNAVAILABLE, cause\)/,
    );
    expect(handler, 'the thrown path does not surface the unavailable refusal').toContain(
      'setFailure(SIGN_IN_UNAVAILABLE)',
    );
  });

  it('requires all three values before it asks the service about them', () => {
    // `required` lets the browser's own validation stop an empty submission in
    // the user's own language. The credential form once marked neither field, so a blank submit reached
    // `normalizeUsername`, was refused locally, and rendered "Korisničko ime
    // ili lozinka nisu točni." — telling somebody their credentials are wrong
    // when they had not entered any. UX-DR34 names the problem instead.
    // STORY 7.7: the organization field too.
    // SOURCE STRUCTURE B7: in the form, the part that renders the fields.
    expect(inputElements(source(SIGN_IN_FORM)), 'the form renders no field to read').toHaveLength(3);
    for (const input of inputElements(source(SIGN_IN_FORM))) {
      expect(input, `a sign-in field is not required: ${input}`).toContain('required');
    }
  });
});
