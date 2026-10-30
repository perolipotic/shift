import {
  ACCENT_KEYS,
  AUTH_LAYOUT,
  CALENDAR_EMPTY_DAY_KEYS,
  CALENDAR_MODIFIER_KEYS,
  CALENDAR_OVERRIDE_WRITE_KEYS,
  CALENDAR_ROSTER_WRITE_KEYS,
  CALENDAR_SNAPSHOT_KEYS,
  CHROME,
  CREDENTIAL_COPY_KEYS,
  DANAS,
  DESTINATION_COPY_KEYS,
  DESTINATION_SCREENS,
  EMAIL_NOTIFICATIONS_KEYS,
  ERROR_SCREEN,
  FILTER_BAR_KEYS,
  GODISNJI,
  LEAVE_REQUEST,
  HOUR_BAND_EDIT,
  HOUR_BAND_LIST,
  HOUR_BAND_LIST_KEYS,
  HOUR_BAND_WRITE_KEYS,
  HOURS_EXPLANATION_KEYS,
  HOURS_EXPORT_KEYS,
  HOURS_KEYS,
  KALENDAR,
  LEAVE_OVERVIEW_KEYS,
  LEAVE_SECTION_KEYS,
  LOCKUP,
  MEMBER_CREATE,
  MEMBER_DIRECTORY,
  MEMBER_EDIT,
  MEMBER_FACTS_KEYS,
  MEMBER_LIST,
  MEMBER_LIST_KEYS,
  MEMBER_MOVE_PREVIEW_KEYS,
  MEMBER_WRITE_KEYS,
  memberListKeys,
  memberWriteKeys,
  MESSAGE_KEYS,
  messageKeyUnion,
  messageKeyUnions,
  MY_LEAVE_KEYS,
  NAVIGATION_MESSAGE_KEYS,
  NOT_FOUND,
  NOTIFICATIONS,
  NOTIFICATIONS_KEYS,
  ORGANIZATION_HOURS_KEYS,
  PUSH_KEYS,
  ORGANIZATION_MESSAGE_KEYS,
  POSITION_KEYS,
  RANK_KEYS,
  ZA_ODLUKU,
  REPLACEMENT_CANDIDATE_KEYS,
  RESOLUTION,
  RESOLUTION_SCREEN_KEYS,
  RESOLUTION_WRITE_KEYS,
  LEAVE_REQUEST_REVIEW,
  LEAVE_REQUEST_REVIEW_KEYS,
  ROTATION_DISPOSITION_KEYS,
  ROTATION_HISTORY_DIALOG,
  ROTATION_HISTORY_KEYS,
  ROTATION_LIST_KEYS,
  ROTATION_OVERRIDE_REVIEW,
  ROTATION_SECTION,
  ROTATION_STEPPER_KEYS,
  ROTATION_WARNING_KEYS,
  ROTATION_WRITE_KEYS,
  SATI,
  SCREEN,
  SET_PASSWORD_KEYS,
  SET_PASSWORD_SCREEN,
  SETTINGS,
  SHIFT_TYPE_EDIT,
  SHIFT_TYPE_LIST,
  SHIFT_TYPE_LIST_KEYS,
  SHIFT_TYPE_WRITE_KEYS,
  TEAM_EDIT,
  TEAM_LIST,
  TEAM_LIST_KEYS,
  TEAM_ROSTER,
  TEAM_ROSTER_KEYS,
  TEAM_WRITE_KEYS,
  TODAY_ADMIN_KEYS,
  TODAY_DUTY_KEYS,
  TODAY_KEYS,
  translationKeys,
  UPDATE_NOTICE,
  OFFLINE_NOTE,
  OFFLINE_WRITE_NOTE,
} from './source-guards.fixture';

// `KEY_SOURCES`, shared by the source guards in this folder: every module that can put
// a key on screen, with the reader that finds its keys and the count it is held to.

/**
 * Every source that contributes a key, with the reader that finds them in it.
 *
 * The reader is named per entry rather than assumed, because they are not the
 * same shape: a screen renders `t('key')`, and the message mapping declares its
 * keys as a return-type union in a `.ts` module that renders nothing. Both are
 * "a key this application can put on screen", and the set comparison below is
 * only true if both are read.
 */
export const KEY_SOURCES = [
  // SIXTEEN SINCE STORY 7.7, counted per call: the heading; the organization
  // label (twice: the field's `<Label>` and the URL slug row's), `remembered`,
  // `hint`, `placeholder`, `change` and `changeLabel`; the username and password labels; the
  // toggle's `passwordShow`; `submit` and `pending`; and the disclosure's
  // `trigger`, `heading` and `body`.
  { name: 'the sign-in screen', file: SCREEN, keys: translationKeys, strings: 16 },
  // STORY 7.8. ELEVEN on the set-password step: the heading and the lede; the
  // two field labels and the toggle's `passwordShow`; the two live checks;
  // `submit` and `pending`; `Odjava` and the sign-out refusal. The checks'
  // met / not-yet words and the save's refusals come through the next entry.
  { name: 'the set-password screen', file: SET_PASSWORD_SCREEN, keys: translationKeys, strings: 11 },
  // EIGHT over two unions: the six failures (`setPasswordMessageKey`) — the
  // sixth, `signInAgain`, from the 7.8 review: a refused token after the
  // password landed — and the live checks' two states in words
  // (`ruleStateMessageKey`).
  { name: 'the set-password rules', file: SET_PASSWORD_KEYS, keys: messageKeyUnions, strings: 8 },
  { name: 'the not-found component', file: NOT_FOUND, keys: translationKeys, strings: 2 },
  // A148. THREE on the error screen: the heading, the lede and the retry.
  { name: 'the error screen', file: ERROR_SCREEN, keys: translationKeys, strings: 3 },
  // STORY 8.1. TWO on the update notice: the message and *Osvježi*.
  { name: 'the update notice', file: UPDATE_NOTICE, keys: translationKeys, strings: 2 },
  // STORY 8.2. ONE on the as-of note: *Bez veze · stanje od …*.
  { name: 'the as-of note', file: OFFLINE_NOTE, keys: translationKeys, strings: 1 },
  // STORY 8.3a. TWO on the offline write note: the save's and the sign-in's.
  { name: 'the offline write note', file: OFFLINE_WRITE_NOTE, keys: translationKeys, strings: 2 },
  // THREE on the sign-in frame (visual refresh A): the brand panel's product
  // name, headline and subline, written once and rendered around both steps,
  // so neither step's own count moved.
  { name: 'the sign-in frame', file: AUTH_LAYOUT, keys: translationKeys, strings: 3 },
  { name: 'the failure-to-message mapping', file: MESSAGE_KEYS, keys: messageKeyUnion, strings: 2 },
  // TWELVE on the settings surface: its own `nav.organizacija` heading, five
  // field labels, the save and cancel actions, the logo's own label, the choose
  // action — rendered TWICE, once as the button's text and once as the hidden
  // file input's `aria-label`, because the two controls are one affordance and
  // a screen reader must hear the same word the eye sees — and
  // `nav.organizacija` a second time, as the neutral mark's accessible name for
  // the unreachable case where the organization's own name is blank. The set
  // comparison below dedupes, so twelve `t()` calls over ten keys is correct
  // rather than a count that drifted.
  //
  // The refusal is NOT among them — it reaches `t()` through
  // `organizationMessageKey`, which is the next entry, for the reason the
  // sign-in refusals do: a ternary over codes written in a `.tsx` is executed
  // by nothing.
  // TWELVE on the settings surface, and it is the same number for a different
  // reason since story 1.4c. The logo's `<img>` and neutral mark moved into the
  // shared lockup, taking the mark's borrowed `nav.organizacija` fallback with
  // them; the accent control's own label arrived in its place. Its five OPTION
  // names are not here — they reach `t()` through `accentMessageKey`, which is
  // the entry below, for the reason every refusal on this screen does: a lookup
  // written in a `.tsx` is executed by nothing.
  //
  // So: `nav.organizacija` as the heading, five field labels, the accent label,
  // the save and cancel actions, the logo's own label, and the choose action
  // rendered TWICE — once as the button's text and once as the hidden file
  // input's `aria-label`, because the two controls are one affordance and a
  // screen reader must hear the word the eye sees. The set comparison below
  // dedupes, so twelve calls over eleven keys is correct rather than drift.
  //
  // THIRTEEN SINCE STORY 2.1b: the link to the hour band editor, which renders
  // that screen's own heading as its text.
  //
  // FOURTEEN SINCE MEMBER RANK: the fire-rank setting's label. Its two option
  // names and its status line reach `t()` through `fireRanksMessageKey`.
  //
  // EIGHTEEN SINCE DESIGN REFRESH C: the lede, the logo's accepted formats,
  // and the aside's title and body.
  // NINETEEN since the settings fix: the read's retry reuses `shell.retry`.
  //
  // FORTY-EIGHT SINCE STORY 7.18, the page of facts with a dialog per change.
  // The page: its heading, lede and the hour band link. The read's retry.
  // The shared dialog: its close, cancel and save. *Profil*: its heading, the
  // saved line, the shared `Promijeni`, and per row a label and a change name
  // (the name, the logo and the accent), the logo's two facts in words, and
  // the name dialog's title and label (keys written a second time). The logo
  // dialog: title, hint, the choose action twice (button and file input, one
  // affordance), and the chosen file. The accent dialog: title, label, the
  // UX-DR5 rule and the line when nothing is chosen. *Vrijeme i godina*: its
  // heading, `Uredi` and its name, the saved line, the zone's label, its
  // locked word, the leave year's label and value, the reason, and the
  // dialog's title and two labels. The fire-rank card: heading, `Uredi` and
  // its name, the use label, and the dialog's title, label and hint. The
  // option names, the accent's stored label and the fire-rank status line
  // reach `t()` through their `MessageKey` modules. The aside left the page:
  // its title and body went with it.
  //
  // FIFTY-SEVEN SINCE THE DEFERRED 7.18 WORK: the leave dialog's current
  // leave year, and the *Satni pojasi* card — its heading (the header link's
  // key written a second time), `Otvori` and its name, the bands' label, the
  // count and its value with the names, and the coverage's label and value.
  //
  // FIFTY-EIGHT SINCE C500: the skeleton's loading words, visually hidden.
  // SIXTY-FIVE SINCE STORY 10.3: the email-notifications card's heading and
  // dialog title, `Uredi` and its name, the fact's label (twice: the fact and
  // the dialog's group) and the hint. Its two option names and its status
  // line reach `t()` through `emailNotificationsMessageKey` and
  // `emailNotificationsStatusMessageKey`.
  { name: 'the organization settings surface', file: SETTINGS, keys: translationKeys, strings: 65 },
  {
    // EIGHT on the member list since story 1.5b, up from five, and the number is
    // still small because most of what this screen says is read off a table
    // rather than written into the markup.
    // Its own `nav.ljudi` heading, the search field's label, the level filter's
    // label — which is the COLUMN's key `ljudi.role` rendered a second time,
    // because the control filters exactly what that column shows and two words
    // for one thing is two things to a reader — the table's caption, and the
    // stated row count.
    //
    // The four column headings are NOT among them, and neither are the three
    // filter options, the two level labels or the two refusals: every one of
    // those reaches `t()` through `@/features/members/services/list`, which is the entry below.
    // A lookup written in a `.tsx` is executed by nothing (AD-15), and the 1.5a
    // review shipped two swapped sort keys green for exactly that reason.
    // The three that arrived are the add action, the actions column's own
    // heading — a `<th>` with no text is announced as nothing at all — and the
    // row action, whose name INTERPOLATES the member it acts on because four
    // hundred rows announcing the same three words is four hundred controls a
    // screen-reader user cannot tell apart.
    //
    // TEN SINCE STORY 1.6: the inactive marker, which INTERPOLATES the name it
    // sits beside, and the scheduled-deactivation marker, which interpolates
    // the date as well. Whether a member is inactive today or scheduled out is
    // `@/features/members/services/list`'s decision, as at the organization's today; the screen
    // only renders the kind of cell the column produced.
    //
    // ELEVEN SINCE STORY 1.7a: the link to the teams screen, which renders
    // `smjene.heading`, the teams screen's own heading, as its text.
    //
    // TWELVE SINCE STORY 1.7b: `smjene.membership.none`, the team cell's
    // positive words for a member on no team today.
    //
    // ELEVEN SINCE VISUAL REFRESH B: the two marker keys LEFT for
    // `@/features/members/services/list` (`memberStatusMessageKey`, counted there), where their
    // pairing to a cell is executed, and `ljudi.status.separator` arrived: the
    // visually hidden separator read between a name and its marker badge.
    //
    // THIRTEEN SINCE THE TEAM FILTER: its label, which is the team COLUMN's
    // key `smjene.membership.column` rendered a second time for the reason
    // `ljudi.role` is, and the reset. The three team options reach `t()`
    // through `teamFilterMessageKey`, counted with the rules below.
    //
    // FOURTEEN SINCE DESIGN REFRESH C: the lede.
    //
    // TWENTY-FOUR SINCE STORY 7.6: the stacked rows' caption (the list's
    // name), the edit-link name and the status separator again (three), the
    // allowance's unit beside its figure (`cellUnit`), and the shared sort
    // control's six — `Poredano:`, its accessible name with the direction,
    // the two directions, the sorted option's name with its direction and
    // the picker's name. The rows' field labels are the columns' own keys,
    // `t(column.label)`, counted with the rules.
    //
    // THIRTY-EIGHT SINCE STORY 7.13: the two selects' labels, the count and
    // the reset left with the selects; the three chips arrived — Razina's
    // text, value, ✕, picker and sheet heading, Smjena's (the shared
    // `filter.*` keys) with `Bez smjene` and the pending name, Status's text,
    // ✕, picker and heading — with each option's person count and the
    // summary line's message. FORTY-ONE with the option-chip bar's own part,
    // read with the member list: `Filtri`, its count, and the bar's label.
    //
    // FORTY-THREE SINCE STORY 7.17: the page renders the directory's title —
    // `nav.ljudi` a second time — and its lede. The directory's own words are
    // its set's, below.
    name: 'the member list',
    file: MEMBER_LIST,
    keys: translationKeys,
    strings: 43,
  },
  {
    // STORY 1.7a. EIGHT on the team list: its heading, the link back
    // (`nav.ljudi`, the destination it returns to), the name label, the add
    // action, the created confirmation, the active group's heading and count,
    // and the archived group's count, which IS its heading. Both counts are ICU
    // plurals and are rendered at zero. The row action (edit or view) and the
    // refusals reach `t()` through the two `@/features/teams` modules.
    //
    // FIFTEEN SINCE DESIGN REFRESH C: the lede, the add dialog's open button,
    // heading, close and cancel, and the table's heads (the name label again,
    // and actions).
    // SIXTEEN SINCE THE STACKED ROWS (UX-DR17): the name label once more, on
    // the phone's stacked row.
    name: 'the team list',
    file: TEAM_LIST,
    keys: translationKeys,
    strings: 16,
  },
  {
    // EIGHT on one team: the name label, Save, the archive offer, prompt,
    // confirm and cancel, the note an archived team carries instead of
    // controls, and the link back. The heading (edit or view) and the saved
    // confirmation (renamed or archived) are chosen in `@/features/teams`, below.
    //
    // NINE SINCE DESIGN REFRESH C, as a dialog: its close replaced the link
    // back, and the archive offer shows a short word beside its whole name.
    name: 'the team edit form',
    file: TEAM_EDIT,
    keys: translationKeys,
    strings: 9,
  },
  {
    // FIVE over three unions, so read by `memberListKeys`, which reads every
    // union rather than the first: the row action (edit, or view for an
    // archived team), the one-team heading by the same rule, and the read
    // failure. Zero rows is an answer here, not a refusal. SIX SINCE THE
    // DEFERRED-WORK SWEEP: the read failure's retry.
    name: 'the team list rules',
    file: TEAM_LIST_KEYS,
    keys: memberListKeys,
    strings: 6,
  },
  {
    // NINE over two unions: seven refusals — the empty name, the taken name,
    // the stale screen, the outright refusal, another invalid value, the
    // service, and a team the list lacks — and the two confirmations, a rename
    // and an archive, which are different sentences on purpose.
    //
    // TEN SINCE STORY 1.7b: the in-use refusal, an archive of a team somebody
    // is on today or is scheduled onto.
    //
    // ELEVEN SINCE 0036: a name over the maximum. (0036's archive of a team
    // in a rotation was withdrawn by 0037.)
    name: 'the team write rules',
    file: TEAM_WRITE_KEYS,
    keys: memberListKeys,
    strings: 11,
  },
  {
    // STORY 1.8. FOUR on the roster: the heading while there is no roster to
    // name, the archived note, the ICU plural count, and the link back. The
    // team's name and the members' names are data.
    //
    // FIVE SINCE MEMBER RANK: the name-and-rank line. The rank's own words
    // reach `t()` through `rankMessageKey`.
    //
    // FOUR SINCE TEAM POSITION: the name-and-rank line moved, with the two
    // lines carrying a position, into `@/features/members/utils/position`'s
    // `rosterLineMessageKey`, where a node test executes the choice.
    name: 'the team roster',
    file: TEAM_ROSTER,
    keys: translationKeys,
    strings: 4,
  },
  {
    // STORY 7.17. NINE on the member directory: the search's label and its
    // placeholder, *tvoja smjena*, the count (the roster's own plural), the
    // unavailable notice and its retry, the no-hit line and *Poništi
    // pretragu*, and the no-team line. The names, the teams' names and the
    // rank and position words are data or the roster lines'.
    name: 'the member directory',
    file: MEMBER_DIRECTORY,
    keys: translationKeys,
    strings: 9,
  },
  {
    // ONE on Danas: its own `nav.danas` heading. The line's words and its
    // refusal reach `t()` through `@/features/teams/services/roster`, below.
    //
    // FIFTEEN SINCE STORY 6.1a: the date subline (on the page and under the
    // next shift's date), the retry, the no-rotation and no-shift words, the
    // leave's range, the next shift's plain title and its none sentence, the
    // `count.days` beside both, the week's heading and its link, and the
    // leave word. The cases, the headings and the two lines come through
    // `@/features/today/services/today`, below.
    //
    // TWENTY-FOUR SINCE STORY 6.1b: the leave's cost sentence and its
    // `count.days`; the hours tile's kicker, one band's hours, the separator
    // between bands and *Sati*'s conflict line; the leave tile's kicker, its
    // balance through `count.days` and its hint. Each tile's unavailable
    // sentence is its detail view's own, through `hoursMessageKey` and
    // `myLeaveMessageKey`.
    //
    // TWENTY-SEVEN SINCE STORY 6.2: the duty-block's kicker with the total,
    // its progress (the bar's valuetext and the line under it, written once)
    // and one end of the span (written once, for both ends). Its headline,
    // end line, leg states and notes come through
    // `@/features/today/services/today-duty`, below; each duration is
    // `durationMessageKey`'s.
    //
    // FIFTY-EIGHT SINCE STORY 6.3, thirty-one more: the admin's subtitle
    // (five: the date line again for an admin before their case answers,
    // the subtitle, its separator twice — between shifts and before the team
    // link — and the no-rotation word); *Treba tebe*'s heading, count
    // (`zaOdluku.count`), calm and past lines, a row's date and the action
    // (six); the coverage's heading, members (a plural), full shift, none,
    // off line with its list separator, and link (seven); the absences'
    // heading, none and link (three); the week's heading, region, team
    // column, no-rotation word, legend and its two entries, and link
    // (eight); the admin unavailable line and its retry (two).
    //
    // FIFTY-NINE SINCE THE STORY 6.3 REVIEW: the teams with no rotation
    // today, with a second list separator (two more); the full shift's mark
    // moved into `coverageStaffingMessageKey`'s union, below (one fewer). The
    // status, badges, phases, absent lines and cell names come through
    // `@/features/today/services/admin-today`, below.
    //
    // SIXTY SINCE THE LONE-NOĆ CARRY-OVER: a shift from yesterday still
    // running is marked `od jučer` on its row (one more).
    //
    // FIFTY-EIGHT SINCE B449: an empty day of the week and the today card's
    // no-shift line say inactive or no team through `dayEmptyMessageKey`,
    // counted in the calendar's `empty-day` (two fewer).
    //
    // SIXTY-TWO SINCE STORY 9.5: *Treba tebe*'s rows name their kind
    // (*Odsutnost u smjeni*, *Zahtjev za godišnji odmor*), and a pending
    // request's row its range and its member or the words for one who is gone.
    name: 'the Danas destination',
    file: DANAS,
    keys: translationKeys,
    strings: 62,
  },
  {
    // STORY 6.1a: today's three cases, the next shift's two headings, and
    // the two lines in place of a case (unavailable, unscheduled).
    name: 'the Danas rules',
    file: TODAY_KEYS,
    keys: messageKeyUnions,
    strings: 7,
  },
  {
    // STORY 6.2: the duty's two headlines, its two end lines, the three leg
    // states and the three notes.
    name: 'the Danas duty rules',
    file: TODAY_DUTY_KEYS,
    keys: messageKeyUnions,
    strings: 10,
  },
  {
    // STORY 6.3: the subtitle's four statuses and its working shift with or
    // without times; a row's two badges and its shift with or without times;
    // the three phases, the three absent states and a coverage row's shift
    // with or without times; an absence's line and tomorrow's, each with or
    // without a team; and a week cell's four names.
    //
    // THIRTY-TWO SINCE THE STORY 6.3 REVIEW: a one-day absence's line and
    // tomorrow's, each with or without a team (four), and a working team's
    // staffing, full or nobody rostered (two).
    //
    // THIRTY-THREE SINCE E897: a working shift carried over from yesterday,
    // marked `od jučer` in the subtitle as on the member's card.
    name: 'the Danas admin rules',
    file: TODAY_ADMIN_KEYS,
    keys: messageKeyUnions,
    strings: 33,
  },
  {
    // FOUR over two unions: the roster's two refusals (unknown, and the
    // service) and the Danas line's two openings (the team label, or no
    // team). The own-row read's refusal left with Danas's own read (E804).
    name: 'the team roster rules',
    file: TEAM_ROSTER_KEYS,
    keys: memberListKeys,
    strings: 4,
  },
  {
    // STORY 2.1b. THIRTEEN on the band list: its heading, the link back
    // (`nav.organizacija`), the name and start labels, the add action, the
    // created confirmation, the ICU count, the row action, the window and
    // duration labels, the midnight flag, the coverage sentence, and the bar's
    // uncovered flag. Every figure is data from `@/features/hour-bands/services/list`; the
    // duration's shape and the refusals reach `t()` through the two modules.
    //
    // TWENTY-SEVEN SINCE DESIGN REFRESH C. The coverage sentence became two stat
    // tiles (the covered label and value; the uncovered label, a second use of
    // the flag's key), and the page gained its lede, the explainer's title and
    // body, the dialog's open button, heading, close and cancel, the list and
    // timeline headings, and the table's column heads (the name label again,
    // from, to, the duration label and actions). THIRTY-TWO with the add
    // dialog's computed end: its label, its pending text, the hint, and the
    // preview's duration label and midnight flag.
    // THIRTY-SIX SINCE THE STACKED ROWS (UX-DR17): the phone's row labels its
    // name, from, to and duration fields with the column heads' keys again.
    name: 'the hour band list',
    file: HOUR_BAND_LIST,
    keys: translationKeys,
    strings: 36,
  },
  {
    // TWELVE on one band: its heading, the two field labels, Save, the window
    // and duration labels, the midnight flag, the removal offer, prompt,
    // confirm and cancel, and the link back. FIFTEEN SINCE DESIGN REFRESH C,
    // as a dialog: the window label gave way to the computed end's label,
    // pending text and hint, the dialog's close replaced the link back, and
    // the removal offer shows a short word beside its whole accessible name.
    name: 'the hour band edit form',
    file: HOUR_BAND_EDIT,
    keys: translationKeys,
    strings: 15,
  },
  {
    // FOUR over two unions: the duration's three shapes and the read failure.
    // FIVE SINCE THE DEFERRED-WORK SWEEP: the read failure's retry.
    name: 'the hour band list rules',
    file: HOUR_BAND_LIST_KEYS,
    keys: memberListKeys,
    strings: 5,
  },
  {
    // ELEVEN over two unions: nine refusals — the blank name, the taken name,
    // the taken start, the invalid start, the stale screen, the outright
    // refusal, another invalid value, the service, and a band the list lacks —
    // and the two confirmations, an edit and a removal.
    //
    // TWELVE SINCE 0036: a name over the maximum.
    name: 'the hour band write rules',
    file: HOUR_BAND_WRITE_KEYS,
    keys: memberListKeys,
    strings: 12,
  },
  {
    // STORY 2.2b. On the shift type list: the destination's own heading, the
    // section heading, the four field labels, the add action, the ICU count, the archived heading, the row action, and
    // what a row says — the non-working pill, the no-times line, the times and
    // duration labels, the midnight flag and the scheduled correction. The
    // kind options, the duration's shape and the refusals reach `t()` through
    // the two modules.
    //
    // TWENTY-FIVE SINCE DESIGN REFRESH C: the lede, the add dialog's open
    // button, heading, close and cancel, the table's column heads (name, kind,
    // the times label again, the duration label, actions), the working pill
    // beside the non-working one; the section heading became the card's.
    // TWENTY-TWO SINCE THE OWNER LAYOUT (story 2.3b): the kind column's
    // head and its two pills are gone; a non-working type reads as a dash.
    // TWENTY-NINE SINCE STORY 7.6: the two section headings again, each
    // naming its phone list, and the stacked rows' five — the name label, the
    // times label twice (the times, and the midnight flag beside the
    // duration), the duration label and the edit link. The no-times line,
    // the scheduled correction and the midnight flag moved out of the table
    // into `shift-type-cells.tsx`, which both forms draw, so each is still
    // written once.
    name: 'the shift type list',
    file: SHIFT_TYPE_LIST,
    keys: translationKeys,
    strings: 29,
  },
  {
    // On one type: the facts a row says (as on the list), the name and Save,
    // the times heading, date, start and end labels, the note, the set and
    // correct actions, the cancellation, the archive offer, prompt, confirm
    // and cancel, the archived note, and the link back.
    // TWENTY-THREE SINCE DESIGN REFRESH C, as a dialog: its close replaced
    // the link back, and the archive offer shows a short word beside its
    // whole accessible name.
    name: 'the shift type edit form',
    file: SHIFT_TYPE_EDIT,
    keys: translationKeys,
    strings: 23,
  },
  {
    // The duration's three shapes, the read failure, and the two headings;
    // since the deferred-work sweep, the read failure's retry.
    name: 'the shift type list rules',
    file: SHIFT_TYPE_LIST_KEYS,
    keys: memberListKeys,
    strings: 7,
  },
  {
    // The two kinds, the thirteen refusals and the five confirmations — the
    // created one among them, rendered through `shiftTypeSavedMessageKey`.
    //
    // TWENTY-TWO SINCE 0036: a name over the maximum, and an archive of a type a
    // rotation in force or scheduled steps through.
    name: 'the shift type write rules',
    file: SHIFT_TYPE_WRITE_KEYS,
    keys: memberListKeys,
    strings: 22,
  },
  {
    // STORY 2.3b. THIRTY-SIX on the builder since the renegotiation — the
    // two move labels gone; the handle's name and role description, the
    // keyboard instructions, and the four announcements (lifted, over,
    // dropped, and cancelled from two events) added. Before it, THIRTY: the three card headings and their
    // ledes (the anchor note is the offsets card's), the empty pattern, the
    // steps' caption and position, the archived label, the three step
    // actions, the new step and its add, the three figure labels, the cycle
    // length and the unknown hours, the anchor, the three offset columns, a
    // team's step label and its options, the empty offsets note, the date
    // column, the save and its note. The hours' shape comes
    // through `shiftTypeDurationMessageKey`, counted with the shift type list
    // rules; the refusals and the confirmation through the two modules below.
    name: 'the rotation builder',
    file: ROTATION_SECTION,
    // THIRTY-SEVEN SINCE THE OWNER ADDITION: the spread action. FORTY-ONE
    // SINCE THE OWNER LAYOUT: the non-working steps figure, the callout's
    // title and body, and the day-number column head; the date column head
    // went with the transposed preview.
    // FORTY-FOUR SINCE THE CYCLES CHOICE: its label, its ICU options and
    // the cycle's name over each cycle's first day.
    // FORTY-EIGHT SINCE STORY 2.4: the stepper's progress line, the bar's
    // label, a reached step's "završeno" and Natrag. The step names and
    // Dalje's labels come through `@/features/rotation/utils/stepper`, counted below.
    // SIXTY-THREE SINCE STORY 2.6: `Vrijedi od`; the cancel's offer, prompt,
    // keep and confirm; and the history's heading, lede, empty note, five
    // column heads, save time and team count. The statuses and the unknown
    // author come through `@/features/rotation/services/history`, counted below.
    // SIXTY-FOUR SINCE STORY 3.5c: the save's confirmation counts the
    // overrides left pending. The review itself is the next entry.
    // SEVENTY-SEVEN SINCE STORY 5.5a: the erasure confirmation's title, lede,
    // row title, the row's two second lines (the team free, or working
    // without the member), the toggles' group label, the two toggles, the way
    // back, the kept hint and its own save (the builder's save key, written a
    // second time); and the refusal when the check cannot be derived, with
    // its retry.
    // SEVENTY-NINE SINCE THE 5.5a REVIEW: the line when the list changed
    // since it was decided, and the save's confirmation counting the
    // conflicts it removed.
    // NINETY-FOUR SINCE STORY 5.5g: the cancel's own erasure dialog — its
    // title, lede, changed line, row title, the row's two second lines, the
    // toggles' group label, the two toggles, the way back, the kept hint and
    // its own save (the cancel's confirm key, written a second time) — the
    // refusal inside the cancel's confirmation, with its retry, and the
    // cancel's notice counting the conflicts it removed.
    // NINETY-EIGHT SINCE STORY 5.5c: the save bar's region label, its
    // "Odbaci promjene" and its hint, with and without the rotation in force.
    // EIGHTY-EIGHT SINCE STORY 7.18: the history's ten moved to its own
    // dialog, the next entry.
    // NINETY SINCE THE STACKED OFFSETS (UX-DR17): the phone's row labels the
    // team and the anchor's type with the column heads' keys again.
    keys: translationKeys,
    strings: 90,
  },
  {
    // STORY 7.18: the history behind a header button — the button and the
    // dialog's title (the heading key, written twice), its close and lede,
    // the empty note, the five column heads, the save time and the team
    // count. The statuses and the unknown author come through
    // `@/features/rotation/services/history`.
    // SIXTEEN SINCE THE STACKED ROWS (UX-DR17): the heading is read once now
    // (eleven), and the phone's row labels its five fields with the column
    // heads' keys again.
    name: 'the rotation history',
    file: ROTATION_HISTORY_DIALOG,
    keys: translationKeys,
    strings: 16,
  },
  {
    // STORY 3.5c: the review's heading, lede and count; a row's title, type,
    // projected type or no rotation, reason, author and unknown author, and
    // its three actions; the amend's title, close, two labels, cancel, save
    // and saving; and the discard's two prompts, cancel, confirm and
    // discarding; and the review that cannot be derived. The refusals and
    // what a landed disposition says come through
    // `@/features/rotation/services/override-disposition`, below.
    // FORTY-TWO SINCE STORY 5.5h: the review's erasure confirmation — its
    // title, a confirm's and an amend's lede, changed line, row title, the
    // row's "taj dan slobodna" line, the toggles' group label, the two
    // toggles, the way back, the kept hint, and its own save, "Potvrdi
    // izmjenu" or "Spremi izmjenu" (the amend's key written a second time) —
    // the refusal when the check cannot be derived,
    // with its retry, and the landed disposition's count of the conflicts it
    // removed. The hook renders no string.
    // FIFTY SINCE 0039: a pending roster override's row — its change, said
    // as a replacement, an arrival or a removal, with an unknown member named
    // as the unknown author is — its amend's title and member field, its
    // discard's prompt, and its erasure row's "taj dan bez {member}" line.
    name: 'the rotation override review',
    file: ROTATION_OVERRIDE_REVIEW,
    keys: translationKeys,
    strings: 50,
  },
  {
    // STORY 3.5c: the six refusals of a disposition (an archived team or type
    // among them), 0035's seventh (the governing rotation version changed),
    // and the three things a landed one says — confirmed, amended, discarded.
    // 0039 adds two roster refusals: the same arriving member, and one
    // already put on by another live change.
    name: 'the rotation disposition rules',
    file: ROTATION_DISPOSITION_KEYS,
    keys: memberListKeys,
    strings: 12,
  },
  {
    // STORY 2.4: the four step names and Dalje's three labels, one per step
    // it can lead to.
    name: 'the rotation stepper rules',
    file: ROTATION_STEPPER_KEYS,
    keys: memberListKeys,
    strings: 7,
  },
  {
    // STORY 2.5: the six warning lines (gap, duplicate, and the rest gap
    // known, unknown, endless and endless unknown), the summary counting
    // them, a date's detail, and the list's and the run's separators.
    // ELEVEN: a doubled type of a duplicate date, naming its teams.
    name: 'the rotation warning rules',
    file: ROTATION_WARNING_KEYS,
    keys: memberListKeys,
    strings: 11,
  },
  {
    // STORY 2.6: the history's three statuses, in words, and the unknown author.
    // `memberListKeys`, as the warning rules use, because the module holds TWO
    // `\w*MessageKey` unions: `messageKeyUnion` reads only the first and would
    // drop the unknown author. It has no quoted `label:` entry to over-read.
    name: 'the rotation history rules',
    file: ROTATION_HISTORY_KEYS,
    keys: memberListKeys,
    strings: 4,
  },
  {
    // STORY 3.1. EIGHT on Kalendar: its own `nav.kalendar` heading, the month
    // heading, the previous and next months' names, `Ovaj mjesec`, the date
    // column head, the no-rotation label and the no-teams note. The read
    // failure comes through `@/features/calendar/services/snapshot`, below. THIRTEEN SINCE STORY
    // 3.2a: the mode switch's label and its two modes, the no-team notice and
    // a day on no team. FOURTEEN SINCE STORY 3.2b: the legend's heading. The
    // marks' labels come through `@/features/calendar/utils/modifiers`, below. EIGHTEEN SINCE
    // STORY 3.3a: the team filter's label, its all-teams option, the heading
    // over the teams and the reset. TWENTY SINCE STORY 3.3b: the heading over
    // the people and a person on no team all month. TWENTY-SIX SINCE STORY
    // 3.4b: the day detail's title, its close, the heading over its roster,
    // the empty roster, an off day and a day with no rotation. The roster's rank and
    // position labels come through `@/features/members/utils/rank` and `@/features/members/utils/position`,
    // already key sources. THIRTY-TWO SINCE STORY 3.5a: the override block's
    // heading, the projected type, the author, the unknown author, the time
    // it was saved and its reason. FORTY-TWO SINCE STORY 3.5b: the form's
    // heading, its two labels, save and saving, and the removal's action,
    // prompt, confirm, cancel and removing. The refusals come through
    // `@/features/calendar/services/override-write`, below. FORTY-NINE SINCE
    // STORY 3.5c: the pending block's heading, body and type, its reason,
    // author and unknown author, and the removal's prompt with no rotation.
    // FIFTY-NINE SINCE STORY 3.6a: the roster changes' heading and pending
    // heading, an addition, a removal and a replacement, each change's
    // author, time and reason, and the unknown member twice — named on the
    // roster and in a change.
    // SEVENTY-FOUR SINCE STORY 3.6b: the roster form's heading, its two
    // member labels, "— nitko —" twice (one per `Select`), its reason, save
    // and saving; the removal's action, prompt, confirm, cancel and removing;
    // the inert block's heading; and a member on no team. The unknown member
    // of a change line moved with the line to `roster-form.tsx` (net zero).
    // The refusals and the notices come through
    // `@/features/calendar/services/roster-write`, below.
    // SEVENTY-FIVE SINCE EPIC 4 RETRO C2: the roster form's overlap hint.
    // SEVENTY-SIX SINCE STORY 5.3c: the unavailable alert's retry. The marks'
    // labels still come through `@/features/calendar/utils/modifiers`.
    // NINETY-TWO SINCE STORY 5.5b: the roster change's erasure confirmation —
    // its title, lede, changed line, row title, the row's two second lines,
    // the toggles' group label, the two toggles, the way back and the kept
    // hint, and its own save, "Spremi promjenu" or "Ukloni" (both keys written
    // a second time) — the refusal when the check cannot be derived, with its
    // retry, and the landed write's count of the conflicts it removed.
    // NINETY-THREE SINCE THE 5.5b REVIEW: a removal's own lede and kept hint;
    // the row's "taj dan slobodna" is gone, since a roster change never makes
    // the team free.
    name: 'the Kalendar destination',
    file: KALENDAR,
    keys: translationKeys,
    // ONE HUNDRED AND TEN SINCE STORY 5.5f: the shift-type override's erasure
    // confirmation — its title, a set's and a removal's lede, the changed
    // line, row title, the row's "taj dan slobodna" line, the toggles' group
    // label, the two toggles, the way back, a set's and a removal's kept
    // hint, and its own save, "Spremi izmjenu" or "Ukloni" (both keys written
    // a second time) — the refusal when the check cannot be derived, with
    // its retry, and the landed write's count of the conflicts it removed.
    // ONE HUNDRED AND TWENTY-ONE SINCE STORY 7.4: the month toolbar's group
    // name, the trigger's name, the month heading twice more (the trigger's
    // visible text and a picker month's name, "Ožujak 2025"), "ovaj mjesec"
    // three times (the trigger's name, its label and the current picker
    // month's name), the picker's name, the year's ‹ and ›, and "ovaj" under
    // the current month.
    // ONE HUNDRED AND THIRTY-EIGHT SINCE STORY 7.5: the filter `Select`'s
    // label, its "all" option, its two group labels and its reset (five) gave
    // way to the shared filter bar's twenty-two — the bar's group name,
    // `Filtri` with and without its count, `Poništi filtre`, the two pickers'
    // names, `Sve smjene` and a team's person count (twice each: the picker
    // and the sheet), the teams' group heading, `Sve osobe`, `Bez smjene`,
    // the search's label and its match count, the sheet's title, close,
    // Smjena and Osoba headings, the note that a person replaces the team,
    // and `Poništi` and `Prikaži`. The summary, a chip's text and a ✕'s name
    // are `t()` calls here too, but over keys `@/utils/filter-bar` chooses —
    // `t(filterSummaryMessageKey(…))` — so those keys are counted in that
    // module, a key source, and not here.
    // ONE HUNDRED AND SIXTY-TWO SINCE STORY 7.9: day detail is facts, and each
    // change is its own dialog — *Izmjene*'s heading and empty sentence; the
    // conflict's heading, line and "Odluči"; the footer's two
    // openers; each dialog's close and cancel, and its description (the day,
    // or the day with its type and times); a "Dolazi" group's heading; and
    // *Što se mijenja* — its label, the type from and to (a type with its
    // times), who leaves and who arrives (or an unknown name), the hours of a
    // group of members, signed less or more, or nobody's. ONE HUNDRED AND
    // SIXTY-SEVEN SINCE ITS REVIEW: the type dialog's placeholder, a conflict
    // line without dates, an unknown member's name, the preview's side with
    // no rotation, and the notice when the day stops offering the roster form;
    // each dialog's close now names its change. ONE HUNDRED AND SIXTY-EIGHT
    // SINCE ITS CODE REVIEW: the notice when the day stops offering the type
    // form with no override on it.
    //
    // ONE HUNDRED AND SIXTY-FIVE SINCE B449: an empty day, the viewer's empty
    // month and a person's say inactive or no team through `empty-day`'s
    // unions, counted there (three fewer).
    // ONE HUNDRED AND SEVENTY-ONE SINCE THE DEFERRED-WORK SWEEP: the month
    // picker's phone sheet — its title and close (E792) — and its footer — the
    // key hint and `Ovaj mjesec` (E795); and *Moj raspored*'s sentence, with
    // the team and without (E822).
    strings: 171,
  },
  {
    // B449: what an empty day or month says — inactive, or on no team — for
    // a day, the viewer's month and a chosen person's. `memberListKeys`, for
    // the module's TWO unions.
    name: 'the calendar empty-day words',
    file: CALENDAR_EMPTY_DAY_KEYS,
    keys: memberListKeys,
    strings: 6,
  },
  {
    // STORY 3.2b: the four marks' labels and the no-rotation label a cell's
    // full label reads. `memberListKeys`, because the module holds TWO
    // `\w*MessageKey` unions and `messageKeyUnion` reads only the first.
    name: 'the calendar modifier vocabulary',
    file: CALENDAR_MODIFIER_KEYS,
    keys: memberListKeys,
    strings: 5,
  },
  {
    // STORY 4.1b. TWELVE on Sati: its own `nav.sati` heading; the shared month
    // navigation's four (the heading, previous, current, next — counted in the
    // Kalendar set too, and deduped by the set comparison); and the summary's
    // seven — the total's and the count's labels, the shift count twice (the
    // month's and a band's), the bands' heading, the leave row and the
    // untimed note. Every hour figure reaches `t()` through
    // `@/features/hour-bands/services/list`'s `durationMessageKey`, already a
    // key source, and the failure through `@/features/hours/services/my-hours`.
    //
    // TWENTY-SIX SINCE STORY 4.2: an admin's organization table — its
    // caption, its five fixed headings (a band's is its name as stored), the
    // two filters' labels and "all" options and the no-team mark (eleven);
    // the shift count twice more (a row's and a band cell's) and the untimed
    // note once more (the table's own). Its empty lines come through
    // `@/features/hours/services/organization-hours`, a key source.
    //
    // TWENTY-SEVEN SINCE STORY 4.3: the export's failure line. Its action's
    // two labels come through `hoursExportMessageKey`, and the sheet's
    // headings and names through `@/features/hours/services/hours-export`,
    // a key source.
    // The empty leave mark comes through `leaveShownOf` in
    // `@/features/hours/services/my-hours`, a key source.
    //
    // THIRTY SINCE STORY 5.3d: the viewer's own line of shifts in unresolved
    // conflict, the table's conflicts heading, and the retry the unavailable
    // message offers when a read failed.
    //
    // FORTY-ONE SINCE STORY 7.4: the shared month toolbar's eleven more,
    // counted in the Kalendar set too.
    //
    // SIXTY-ONE SINCE STORY 7.5: the two filters' labels and "all" options
    // (four) gave way to the shared filter bar's twenty-two, counted in the
    // Kalendar set too, and the empty table's two ways out, `Ukloni filtar:
    // Smjena B` and `Poništi filtre`. Its sentences' keys are chosen by
    // `@/features/hours/services/organization-hours` and the month in the
    // locative's by `@/utils/filter-bar`, both key sources.
    //
    // EIGHTY-FOUR SINCE STORY 7.6: the stacked rows' seventeen — the sort
    // control's five fixed column headings, the caption naming the list,
    // each value's label (member, team, shifts, total, leave, conflicts —
    // six), the no-team mark, the shift count twice (the row's and a
    // band's), the conflict line and the untimed note — and the shared sort
    // control's six, `Poredano:`, its accessible name with the direction,
    // the two directions, the sorted option's name with its direction and
    // the picker's name, counted in the member list too. A band's label is
    // its name as stored. The empty result moved to its own part
    // (`organization-hours-empty.tsx`) and is counted once, as before.
    //
    // ONE HUNDRED AND FIVE SINCE STORY 7.14: the table's footer label and the
    // phone's (two), the export's status line, a member's own title, and the
    // explanation's — the ⓘ's name, the dialog's close and two fallbacks of
    // its title (a title and a description), the line, the `+` and `=` marks,
    // the sum's name, the empty and the unavailable sentences — and the figure
    // names each ⓘ is given (the total's and the leave's words, in the summary and
    // twice in each of the table and the stacked rows). The figure's
    // words and the source's three come through
    // `@/features/hours/services/hours-explanation`, a key source.
    //
    // ONE HUNDRED AND SIX SINCE THE 7.14 REVIEW: a line's words for a shift in
    // unresolved conflict, beside its `⚠` (FR-42b).
    //
    // ONE HUNDRED AND FIVE SINCE LEAVE IN DAYS: a line's words are made by
    // `@/features/hours/services/hours-explanation` (a key source), since a
    // leave line pairs each shift's team and type, so the dialog renders the
    // line it is given.
    //
    // ONE HUNDRED AND SIX SINCE E909: the conflicts column sorts, so the
    // phone's sort control offers its heading too.
    //
    // ONE HUNDRED AND TEN SINCE THE DEFERRED-WORK SWEEP: the shared month
    // picker's phone sheet, its title and close (E792), and its footer, the
    // key hint and `Ovaj mjesec` (E795).
    //
    // ONE HUNDRED AND ELEVEN SINCE C587: the no-team mark moved out of the
    // table and the stacked rows (two) into `hours-marks.tsx`, once, beside
    // the two words a screen reader hears for an empty mark — `nema` for the
    // leave and `bez smjene` for the team. The leave's glyph still comes off
    // `leaveShownOf`, a key source.
    name: 'the Sati destination',
    file: SATI,
    keys: translationKeys,
    strings: 111,
  },
  {
    // STORY 5.2c. THREE on Godišnji: its own `nav.godisnji` heading, the
    // retry, and `count.days` once — written once inside the map over the
    // three tiles. The tiles' labels and the two lines in place of the figures
    // come through `@/features/leave/services/my-leave`, a key source.
    //
    // THIRTY-SIX SINCE STORY 7.15: the admin's overview — the page's lede,
    // its own unavailable line and retry (beside the member's), the search's
    // label and placeholder, the summary, the empty sentences and
    // *Poništi pretragu*, the overview's unavailable line and retry, and the
    // five column names, the caption, *Bez smjene* and the unscheduled line,
    // written once in the table and once in the stacked rows.
    //
    // FIFTY SINCE E884: the Smjena chip's six, as Ljudi's (its text set and at
    // every team, its ✕, its picker and heading, and an option's count), the
    // pending team name, the Stanje chip's four (its text, ✕, picker and
    // heading) and its options' count, and the empty line the chips leave
    // with *Poništi filtre*.
    //
    // SIXTY-THREE SINCE STORY 9.3: *Zatraži godišnji* and the sent line on
    // the page; and the requests list's heading, its empty and unavailable
    // lines with the retry, a row's range with and without its cost, the
    // cost, the hidden range and state labels, *Povuci zahtjev* and its
    // accessible name, and the withdrawn line. The status words, the closing
    // date's line and the refusals come through
    // `@/features/leave/services/my-leave`.
    name: 'the Godišnji destination',
    file: GODISNJI,
    keys: translationKeys,
    strings: 63,
  },
  {
    // STORY 9.3. On the request form: its heading (twice, once while the role
    // is read) and lede, od and do, the cost and the balance after it with
    // `count.days`, the in-year charge, the two notes, *Pošalji* and
    // *Odustani*, the unavailable line with its retry, *Natrag na Godišnji*,
    // and the page's own retry while the role cannot be read. The reasons,
    // the refusals and the unscheduled line come through
    // `@/features/leave/services/my-leave`, a key source.
    name: 'the leave request form',
    file: LEAVE_REQUEST,
    keys: translationKeys,
    strings: 18,
  },
  {
    // E884: the Stanje chip's five options and the five values its text says,
    // off `leaveOverviewStateMessageKey` and `leaveOverviewStateValueMessageKey`.
    name: 'the Godišnji overview rules',
    file: LEAVE_OVERVIEW_KEYS,
    keys: messageKeyUnions,
    strings: 10,
  },
  {
    // STORY 5.3b. NINE on Za odluku (Raspored until story 9.1): its own `nav.zaOdluku` heading; the
    // unavailable line and its retry; the count, always shown, and the empty
    // sentence; and a row's four — the past words, the member and team, and
    // the shift with the causing range, with and without times. Its rules
    // module renders no string, so it is no key source.
    name: 'the Za odluku destination',
    file: ZA_ODLUKU,
    keys: translationKeys,
    // STILL NINE SINCE STORY 5.4b: the status line a decision returns with
    // reads through `resolutionSavedMessageKey`, the rules' union below.
    // TWENTY-THREE SINCE STORY 7.16: the two tabs' name, label and queue count
    // (four), and the Odlučeno list's count, empty sentence, shift-gone line,
    // the decisions (accepted, replacement with and without a name, amended),
    // and who decided it and when, with the words for an admin no longer
    // there.
    // THIRTY-FIVE SINCE STORY 9.5: each item names its kind, on Čeka odluku
    // (*Odsutnost u smjeni*, *Zahtjev za godišnji odmor*) and on Odlučeno
    // (both again); a pending request's row, its member or the words for one
    // who is gone, and its range; a decided request's row, its outcome
    // (*Odobren*, *Odbijen*), its member or the gone words, its range, and
    // who decided it and when, with the words for an admin no longer there.
    // THIRTY-SIX SINCE 0041: a request closed on its member's deactivation,
    // *Zatvoren deaktivacijom*, as its own outcome.
    strings: 36,
  },
  {
    // STORY 5.4b. On one conflict's screen, through `t('…')`: the way back
    // with its count and plainly, the heading, the place in the queue, ‹ and
    // › with a date and at an end, the conflict's mark, the absent member's
    // leave, the choice's heading and hint, the card's title and sentence,
    // the strip's three labels, the uncovered mark, the balance and its
    // unchanged line, Odustani, Spremi odluku and its pending label, the
    // missing line, and the unavailable line with its retry. The rest come
    // through the rules' unions below.
    // THIRTY-THREE SINCE STORY 5.4c: the second card's title and sentence,
    // the replacement's name in its strip, the picker's heading and its
    // nobody-to-add line, and the generated reason.
    // THIRTY-SIX SINCE STORY 5.4d: the third card's title, the absent member
    // working in its strip, and the balance it gives back.
    // THIRTY-EIGHT SINCE STORY 5.5d: Spremi's hint while a replacement that
    // no longer applies holds the key, and its link to the calendar.
    // FORTY SINCE D726: the third card's line naming the days a later start
    // drops, and the line saying some of them are past.
    name: 'the conflict resolution screen',
    file: RESOLUTION,
    keys: translationKeys,
    strings: 40,
  },
  {
    // STORY 5.4b: the facts line with and without times, who else works or
    // nobody, the save hint before and after a choice, the hours as leave or
    // the empty mark, the coverage term, and the queue's status line by the
    // saved outcome.
    // SIXTEEN SINCE STORY 5.4c: the hint while nobody is picked and while
    // nobody can be, the three candidate group headings, and the status line
    // naming the replacement.
    // TWENTY-THREE SINCE STORY 5.4d: the third card's three sentences (the
    // leave starts later, ends earlier, or is removed), its hours as work or
    // the empty mark, and the hint once it is chosen, with a date or for a
    // removal.
    // TWENTY SINCE STORY 7.9: the three candidate group headings moved to the
    // calendar's public `utils/replacement-candidates`, counted there.
    // TWENTY-TWO SINCE STORY 9.4: the status line for a leave request
    // approved or rejected on its own screen, in the same slot.
    name: 'the conflict resolution rules',
    file: RESOLUTION_SCREEN_KEYS,
    keys: messageKeyUnions,
    strings: 22,
  },
  {
    // STORY 9.4. On one leave request's decision screen, through `t('…')`:
    // the way back, the heading, the missing and unavailable lines with the
    // retry, the range, the cost and the balance after approval with
    // `count.days`, the in-year charge, the overlap and over-balance notes,
    // the decided line with its admin (or one no longer a member), the
    // withdrawn date, and *Odbij* and *Odobri*. The status word comes through
    // `@/features/leave/services/my-leave`, the base lines and the refusals
    // through the rules below, and the collisions through the dialog's lines.
    // TWENTY SINCE ITS REVIEW: the neutral line for a member gone from both
    // lists, on the facts and as the queue's line names them.
    name: 'the leave request decision screen',
    file: LEAVE_REQUEST_REVIEW,
    keys: translationKeys,
    strings: 20,
  },
  {
    // STORY 10.3. On *Obavijesti*: its heading and lede; the email card's
    // heading, the loading words, the unavailable line and its retry, the
    // no-address line, the address label, the organization-off line, the
    // control's label, its two options and the failure notice. The saved
    // line comes through `emailStatusMessageKey`, the entry below.
    // TWENTY-FIVE SINCE STORY 10.4: the push card's heading, its loading
    // words, the iOS-install, unsupported and blocked lines, the unavailable
    // line and its retry, its lede, its control's label, its two options and
    // its failure notice. Its saved line comes through `pushStatusMessageKey`.
    // TWENTY-SIX: the line a build with no VAPID public key shows.
    name: 'the notification settings screen',
    file: NOTIFICATIONS,
    keys: translationKeys,
    strings: 26,
  },
  {
    // STORY 10.4: the push section's two saved lines, off `pushStatusMessageKey`.
    name: 'the push settings rules',
    file: PUSH_KEYS,
    keys: messageKeyUnions,
    strings: 2,
  },
  {
    // STORY 10.3: the two saved lines, off `emailStatusMessageKey`, and the
    // two ledes, one per role, off `ledeMessageKey`.
    name: 'the notification settings rules',
    file: NOTIFICATIONS_KEYS,
    keys: messageKeyUnions,
    strings: 4,
  },
  {
    // STORY 10.3: the organization's email-notifications switch — its two
    // option labels and its two status lines, off two unions.
    name: 'the email-notifications switch labels',
    file: EMAIL_NOTIFICATIONS_KEYS,
    keys: messageKeyUnions,
    strings: 4,
  },
  {
    // STORY 9.4: the base's three lines in place of the figures (unavailable,
    // unscheduled, absent) and the decision's four refusals, off
    // `reviewBaseMessageKey` and `reviewFailureMessageKey`.
    // EIGHT SINCE 0041: an approval refused because the member is inactive
    // on a date of the request.
    name: 'the leave request decision rules',
    file: LEAVE_REQUEST_REVIEW_KEYS,
    keys: messageKeyUnions,
    strings: 8,
  },
  {
    // STORY 7.9: the three candidate group headings — free, working that day,
    // on leave that day — shared by the conflict screen's picker and the day
    // detail's roster dialog, off `candidateGroupMessageKey`.
    // FOUR SINCE D717: a candidate's line with the continuous duty the shift
    // would make, off `candidateContinuousMessageKey`.
    name: 'the replacement candidate groups',
    file: REPLACEMENT_CANDIDATE_KEYS,
    keys: messageKeyUnions,
    strings: 4,
  },
  {
    // STORY 5.4b: the write's three refusals — gone, denied, failed. FOUR
    // SINCE STORY 5.4c: the replacement already on the shift. FIVE SINCE
    // STORY 5.5d: the key a replacement that does not apply still holds.
    name: 'the conflict resolution write',
    file: RESOLUTION_WRITE_KEYS,
    keys: messageKeyUnions,
    strings: 5,
  },
  {
    // STORY 5.2c: the two lines in place of the figures (unavailable,
    // unscheduled), off `myLeaveMessageKey`, and the three tiles' labels, as
    // `label` entries — `memberListKeys` reads both shapes.
    // TWENTY-TWO SINCE STORY 9.3: the request form's four reasons and four
    // refusals, the withdrawal's three refusals, the four status words, and
    // the closing date's two lines, decided and withdrawn.
    // TWENTY-FIVE SINCE 0041: a send refused because the member is inactive
    // in the range, the fifth status word (*Zatvoren deaktivacijom*) and its
    // closing date's line.
    name: 'the Godišnji rules',
    file: MY_LEAVE_KEYS,
    keys: memberListKeys,
    strings: 25,
  },
  {
    // STORY 4.1b: the hours' one failure, a read or a domain refusal alike.
    // TWO SINCE THE EMPTY LEAVE FIX (Epic 4 retro, R2): the empty figure `—`
    // a leave of 0 reads, off `leaveMessageKey`.
    // THREE SINCE LEAVE IN DAYS: a leave reads as its day count, `count.days`,
    // off the same union.
    name: 'the hours rules',
    file: HOURS_KEYS,
    keys: messageKeyUnions,
    strings: 3,
  },
  {
    // STORY 4.2: why an admin's table is empty — nobody matches the filter,
    // or nobody has a row this month.
    // FIVE SINCE STORY 7.5, read off BOTH unions: the month with nobody, the
    // person not in the team chosen (in place of "nobody matches"), the
    // filters showing nobody (a filter alone, which the options rule out
    // today), and where the person is instead — their own team, or none this
    // month.
    name: 'the organization hours rules',
    file: ORGANIZATION_HOURS_KEYS,
    keys: messageKeyUnions,
    strings: 5,
  },
  {
    // STORY 7.5: the filter bar's model — the summary line's five forms, a
    // chip's four (a team or a person, chosen or `sve`), a ✕'s two names,
    // and the twelve months in the locative an empty table's sentence reads.
    name: 'the filter bar rules',
    file: FILTER_BAR_KEYS,
    keys: messageKeyUnions,
    strings: 23,
  },
  {
    // STORY 4.3: the export's sheet — its eight `t()` calls: the five fixed
    // column headings 4.2 already renders, the no-team mark, the sheet's name
    // and the file's — and its action's two labels, the imperative and the
    // one it wears while the file is built, off `hoursExportMessageKey`.
    // ELEVEN SINCE STORY 5.3d: the conflicts column's heading, the table's own.
    // STILL ELEVEN SINCE LEAVE IN DAYS: the leave column's heading names its
    // unit, days, in place of the table's own heading.
    // TWELVE SINCE E922: the footer row's label, the table's own.
    name: 'the hours export rules',
    file: HOURS_EXPORT_KEYS,
    keys: (text: string) => [...translationKeys(text), ...messageKeyUnions(text)],
    strings: 12,
  },
  {
    // STORY 7.14: the figure's name — the total's and the leave's words —
    // the month, the person and month, and a shift's line, off `t()`; and the
    // three words a shift's source reads as, off `hoursSourceMessageKey`.
    // NINE SINCE LEAVE IN DAYS: a shift's line and a leave line's
    // `team · type`, made here rather than in the dialog. TWELVE SINCE ITS
    // REVIEW: a decided shift's leave line (`sati.explain.line` again, with
    // the decision as its source) and the two decisions' words, the resolved
    // queue's own, off `leaveDecisionMessageKey`.
    name: 'the hours explanation rules',
    file: HOURS_EXPLANATION_KEYS,
    keys: (text: string) => [...translationKeys(text), ...messageKeyUnions(text)],
    strings: 12,
  },
  {
    // STORY 5.1c: the leave card's four reasons for no preview (incomplete,
    // reversed, over a year, refused by the domain), its four refusals — the
    // overlap with and without the conflict's dates, denied and failed — and
    // the two lines in place of the figures (unavailable, unscheduled), off
    // `leaveReasonMessageKey`, `leaveRefusalMessageKey` and `leaveBaseMessageKey`.
    // SIXTEEN SINCE STORY 5.2b: the reason an unchanged amend is not sent,
    // the amend's and the removal's own denied and failed lines, and the line
    // for a record already gone.
    // EIGHTEEN SINCE THE 5.2b REVIEW: the removal prompt's two forms, with
    // and without the in-year part, off `leaveRemovePromptMessageKey`.
    name: 'the leave card rules',
    file: LEAVE_SECTION_KEYS,
    keys: messageKeyUnions,
    strings: 18,
  },
  {
    // STORY 3.1: the calendar's one read failure.
    name: 'the calendar read rules',
    file: CALENDAR_SNAPSHOT_KEYS,
    keys: messageKeyUnion,
    strings: 1,
  },
  {
    // STORY 3.5b: the six refusals of setting or removing an override, and
    // the two things a landed write says — saved, and removed. NINE SINCE
    // STORY 3.5c: a pending override removed from a day with no rotation.
    // TEN SINCE STORY 7.9: no type chosen in the type dialog, its own refusal.
    //
    // ELEVEN SINCE 0036: a team or type archived while the day was open.
    name: 'the calendar override write rules',
    file: CALENDAR_OVERRIDE_WRITE_KEYS,
    keys: messageKeyUnions,
    strings: 11,
  },
  {
    // STORY 3.6b: the six refusals of changing a roster or removing a
    // change, and the two things a landed write says — saved, and removed.
    //
    // NINE SINCE 0036: a team archived while the day was open.
    name: 'the calendar roster write rules',
    file: CALENDAR_ROSTER_WRITE_KEYS,
    keys: messageKeyUnions,
    strings: 9,
  },
  {
    // The read failure, and its retry (deferred-work sweep).
    name: 'the rotation read rules',
    file: ROTATION_LIST_KEYS,
    keys: messageKeyUnions,
    strings: 2,
  },
  {
    // The eight refusals, the "nothing changed" note beside a failure after
    // the pattern, and the confirmation.
    // FIFTEEN SINCE STORY 2.6: the past effective date; the cancel's three
    // refusals (stale, and the save's refused and unavailable again) and its
    // confirmation. SIXTEEN: an effective date more than a year ahead.
    name: 'the rotation write rules',
    file: ROTATION_WRITE_KEYS,
    keys: memberWriteKeys,
    strings: 16,
  },
  {
    // THIRTEEN on the create form: its own heading, five field labels, the save
    // and cancel actions, the link back to the list, and the credential panel's
    // three — plus `ljudi.form.username` a SECOND time, as that panel's label
    // for the username it just issued. The set comparison below dedupes, so
    // thirteen calls over twelve keys is correct rather than drift.
    //
    // The password is not among them and never will be: it is data, generated
    // in `admin-auth`, and the one value in this system no later read can
    // recover.
    //
    // FOURTEEN SINCE MEMBER RANK: the rank control's label. Its options reach
    // `t()` through `rankMessageKey`, counted with the rank rules below.
    // NINETEEN SINCE DESIGN REFRESH C: the lede, the two section headings,
    // and the aside's title and body.
    //
    // TWENTY SINCE STORY 7.8: `Kopiraj` on the credential line.
    //
    // NINETEEN SINCE STORY 7.13b, a dialog: the title and lede stay, the two
    // section headings, the aside, the link back and the second username label
    // go; the username's hint, the dialog's close, `Račun je izrađen: {name} ·
    // {username}`, the no-team line, *Dodaj još jednu* and *Otvori stranicu
    // osobe* arrive, and the submit is `Dodaj osobu` rather than `Spremi`.
    name: 'the member create form',
    file: MEMBER_CREATE,
    keys: translationKeys,
    strings: 19,
  },
  {
    // EIGHTEEN on the edit form: its own heading, five field labels, save,
    // cancel, the link back, the confirmation that a save landed, and the
    // admin-issued reset's EIGHT — the offer, the confirmation's prompt, its
    // confirm and cancel, and the shown panel's four (that it was issued, the
    // label over the password, the write-it-down sentence, and the dismiss).
    //
    // The password is not among them and never will be: it is data, generated
    // in `admin-auth`, and the one value in this system no later read can
    // recover. `ljudi.form.credentialOnce` is rendered a SECOND time here — the
    // create panel already shows it — and the set comparison below dedupes, so
    // eighteen calls over seventeen keys is correct rather than drift.
    //
    // `ljudi.form.saved` is the tenth and it is not decoration: every field
    // here is uncontrolled and remounts to the values it was just saved with,
    // so without it a successful save looks identical to a press that did
    // nothing.
    //
    // TWENTY-ONE SINCE STORY 1.6: the status block's three literal keys — the
    // date control's label, the confirmation's cancel, and the confirmation
    // that a change landed. Its status lines, offer, prompt and confirm vary
    // with the member's history and reach `t()` through `@/features/members/services/wire`,
    // which is the entry below.
    //
    // TWENTY-EIGHT SINCE STORY 1.7b: the team block's seven literal calls —
    // the line stating the team today, `Bez smjene` twice (as that line's
    // value and as the picker's "no team" option), the picker's and the date's
    // labels, the confirmation's cancel, and the confirmation that a change
    // landed. Its scheduled line, offer, prompt and confirm reach `t()`
    // through `@/features/members/services/wire`.
    //
    // TWENTY-NINE SINCE MEMBER RANK: the rank control's label, as on the
    // create form.
    //
    // THIRTY-FOUR SINCE DESIGN REFRESH C: the form's two section headings, and
    // the headings of the cards the team, status and password moved into.
    //
    // FIFTY-THREE SINCE STORY 5.1c: the leave card's nineteen literal calls —
    // its heading, the three figures' labels (the allowance's is `ljudi.leave`)
    // and `count.days` for a figure, the form's legend, the od and do labels,
    // the preview's two labels and `count.days` for each, the overlap and
    // over-balance notes, the unavailable line twice (in place of the figures
    // and of a preview the domain refused), the save's two status lines and
    // the save action. Its reasons and refusals reach `t()` through
    // `@/features/leave/services/leave-section`, the entry below.
    //
    // FIFTY-FOUR SINCE THE 5.1c REVIEW: three more — the in-year charge, the
    // plain saved line and the retry — and two fewer, the unavailable line's
    // two literal calls, which now come through `leaveBaseMessageKey` (a
    // preview the domain refuses is a reason, through `leaveReasonMessageKey`).
    //
    // SEVENTY-THREE SINCE STORY 5.2b: nineteen more. The records list's
    // heading and empty line, each row's `count.days`, its two short actions
    // and their two full names, and the removed line; the removal prompt with
    // its `count.days`, its cancel, confirm and in-flight label; and the
    // form's amend legend, save and cancel, and the amended line's two forms
    // with its over-balance warning.
    //
    // SEVENTY-FIVE SINCE THE 5.2b REVIEW: the prompt itself now comes through
    // `leaveRemovePromptMessageKey` (one fewer), and three more — the prompt's
    // in-year `count.days`, a row's in-year line and the row's amend marker.
    //
    // SEVENTY-SIX SINCE STORY 5.4d: "Natrag na Za odluku".
    //
    // SEVENTY-EIGHT SINCE STORY 5.4e: the replacement guard's two lines — a
    // replacement left rostered, and that the replacements cannot be checked
    // — written once in `LeaveReplacementLines` and rendered in the amend
    // preview, the removal confirmation and both notices.
    //
    // NINETY-FOUR SINCE STORY 5.5e: sixteen more. The erasure dialogs' ten
    // words, written once in `memberErasureCopyOf` (title, lede, changed
    // line, a row's title and second line, the toggles' group label,
    // "Potvrdi brisanje", "Zadrži", the way back and the kept hint); and in
    // each of the two cards the unavailable line, its retry and the removed
    // count beside the saved line.
    //
    // NINETY-FIVE SINCE STORY 7.8: `Kopiraj` on the reset's credential line.
    //
    // ONE HUNDRED AND TWENTY-NINE SINCE STORY 7.11, facts and dialogs: the
    // header's fallback title, separator and no-team word; the basics card's
    // heading, facts, edit button and its dialog's title, close and fields;
    // the team card's header button, its dialog's title, description,
    // placeholder, current-team option and Spremi; the allowance's button,
    // notice, dialog and field; the status dialog's question; the sign-in
    // card's heading, line and button; and the leave card's year heading and
    // *Pravo*. Every dialog's close button is `ljudi.page.close`. And the
    // team withdrawal's prompt, written by the card itself.
    //
    // ONE HUNDRED AND FORTY-NINE SINCE STORY 7.12, the leave dialog: the
    // card's *Upiši godišnji* and its name; the dialog's two titles, close,
    // cancel, *Što se mijenja*, *Bilo* and *Sada* with their ranges; the
    // conflict lines (one line's shape, created, where, none, cleared, kept,
    // new, their one group shape and unknown); and the removal's cleared
    // line or its unknown line — less the form's two legends and the row's amend-mode word they
    // replace.
    // ONE HUNDRED AND FIFTY-THREE SINCE THE DEFERRED-WORK SWEEP: the read
    // failure's retry, the status date's hint, the team dialog's *Što se
    // mijenja* heading (decision 16), and the reset dialog's close.
    //
    // ONE HUNDRED AND FIFTY-FIVE SINCE D723: the card's line when a hand-off
    // from a conflict opened nothing, and the amend dialog's line when its
    // od and do came from the conflict.
    // ONE HUNDRED AND FIFTY-SIX SINCE 0041: the deactivation question's line
    // naming the pending leave requests it closes.
    name: 'the member edit form',
    file: MEMBER_EDIT,
    keys: translationKeys,
    strings: 156,
  },
  {
    // THIRTEEN on the member write path's rules: eleven `ljudi.form.error.*`
    // refusals, the LIST's own refusal — reused rather than reworded, because
    // `/ljudi/$id` is reachable by URL and a read the database declines
    // outright is not a failed write — and the partial-save sentence. It is the
    // second key source read by neither `translationKeys` nor
    // `messageKeyUnion`; see `memberWriteKeys`, which reads both shapes this
    // module declares keys in.
    //
    // THE ELEVENTH REFUSAL IS THE RESET'S. "The password was not changed" is
    // its own sentence rather than the service fallback because this surface is
    // the ONLY recovery an account with no email address has, and the fact an
    // admin needs before they tell somebody anything is whether the credential
    // moved at all.
    //
    // THIRTY-FIVE SINCE STORY 1.6: seven refusals a status change can earn —
    // a past date, the caller's own row, a date that already has a version, a
    // date before the latest one, a change that changes nothing, a
    // cancellation of a change already in effect, and a list behind the
    // database (look again); ELEVEN keys the offer,
    // prompt and confirm take across the three changes (a prompt for today
    // and one for a later date, for each of deactivate and reactivate); and
    // the FOUR status lines — today's in the present, the scheduled change's
    // in the future. Paired by `statusOfferMessageKey` and its siblings so
    // the pairing is executed rather than written into the screen.
    //
    // FIFTY-FOUR SINCE STORY 1.7b, all under `smjene.membership.*`: eight team
    // refusals, the two offers (move, cancel the scheduled move), five prompts
    // (onto a team or onto none, today or later, and the cancellation), the
    // two confirms, and the two scheduled lines (onto a team, onto none).
    //
    // SIXTY-TWO SINCE TEAM POSITION: the refusal for an unchanged team AND
    // position, four prompts (a move naming its position, and a position-only
    // change, each today or later), the scheduled line with a position, and
    // the current-team line in both its forms — moved here out of the screen
    // as `teamCurrentMessageKey`'s union.
    //
    // SIXTY-FIVE after review: the refusal for a team with no position while
    // positions are in use, and the two scheduled lines for a change that
    // keeps the team — by position, and neutral while positions are off.
    //
    // SIXTY-ONE SINCE STORY 7.11: five more — the placeholder's refusal
    // (`Odaberi smjenu.`), and the status dialog's title and final button for
    // each of deactivate and reactivate — and nine fewer. A move has no
    // confirmation any more, so its eight prompts are retired, and the
    // withdrawal's prompt is the card's own `t()` call now.
    //
    // SIXTY-FOUR SINCE STORY 7.13c: the deactivation's final button with its
    // date (`statusSubmitMessageKey`), and its consequence in numbers with and
    // without the month clause (`deactivationConsequenceMessageKey`).
    //
    // SIXTY-FIVE SINCE 0036: a name over the maximum.
    name: 'the member write rules',
    file: MEMBER_WRITE_KEYS,
    keys: memberWriteKeys,
    strings: 65,
  },
  {
    // ELEVEN on the member list's rules: four column headings, two permission
    // levels, three counted filter options and two refusals. It is the first
    // key source read by neither `translationKeys` nor `messageKeyUnion` — see
    // `memberListKeys`, which reads both shapes this module declares keys in.
    // TWELVE SINCE STORY 1.7b: the team column's heading.
    // EIGHTEEN SINCE VISUAL REFRESH B: the summary row's four stat labels, read
    // off `membersSummaryOf`'s `label:` entries the way the headings are, and
    // the two inactive-marker keys, which moved here from the screen as
    // `memberStatusMessageKey`'s return union.
    // TWENTY-ONE SINCE THE TEAM FILTER: `teamFilterMessageKey`'s three counted
    // options — every team, a named team, and no team.
    // TWENTY-FOUR SINCE DESIGN REFRESH C: `teamMarkerMessageKey`'s three
    // markers for a scheduled team change — a move, no team, and a change
    // that keeps the team.
    // THIRTY SINCE STORY 7.13: the four stat labels and the two inactive
    // markers left with the stat cards and the name's badge; the status
    // column's heading and its four facts arrived (`memberStatusMessageKey`),
    // the summary line's two forms, the level picker's every-level option,
    // the status chip's three values and its three option names, and the team
    // options are now `Sve smjene` and `Bez smjene` beside their counts.
    // THIRTY-ONE SINCE THE DEFERRED-WORK SWEEP: the read failure's retry.
    name: 'the member list rules',
    file: MEMBER_LIST_KEYS,
    keys: memberListKeys,
    strings: 31,
  },
  {
    // DECISION 16, the deferred-work sweep: the team dialog's last shift in
    // the team left and first in the team joined, each with or without the
    // type's range (`moveShiftMessageKey`).
    name: 'the team move preview rules',
    file: MEMBER_MOVE_PREVIEW_KEYS,
    keys: messageKeyUnions,
    strings: 4,
  },
  {
    // ONE on the lockup: the accessible name it falls back to when the
    // organization's own name is blank. `0002:72` makes that unreachable from
    // the database, but an empty accessible name on a `role="img"` is an
    // element a screen reader announces as nothing at all. Everything else the
    // lockup shows is DATA — the organization's name, its logo — and data is
    // never a key.
    name: 'the organization lockup',
    file: LOCKUP,
    keys: translationKeys,
    strings: 1,
  },
  {
    // FIVE, for four curated accents and no accent — the fourth instance of the
    // `\w*MessageKey` shape, after sign-in, the organization's refusals and the
    // chrome's. It is a mapping rather than a list because the mutation it
    // refuses is invisible in a diff: two swapped branches leave an
    // organization that chose green reading `Plava`, and a `.tsx` lookup is
    // executed by nothing (AD-15). `accent.test.ts` runs it.
    name: 'the accent-to-label mapping',
    file: ACCENT_KEYS,
    keys: messageKeyUnion,
    strings: 5,
  },
  {
    // STORY 7.11. TWO on the member page's header: today's status badge,
    // active or not, off `memberStatusBadgeMessageKey`.
    name: 'the member page header facts',
    file: MEMBER_FACTS_KEYS,
    keys: memberListKeys,
    strings: 2,
  },
  {
    // MEMBER RANK. TWENTY-NINE over four unions: the eleven rank labels, no
    // rank and unknown rank (`rankMessageKey`, 13); the roster's form — the
    // eleven labels again and its own lowercase unknown rank
    // (`rosterRankMessageKey`, 12); the setting's two option labels and its
    // two status lines. The set comparison dedupes the repeated labels. A
    // mapping for the accent's reason: a `.tsx` lookup is executed by nothing,
    // and `rank.test.ts` runs this one.
    name: 'the rank-to-label mapping',
    file: RANK_KEYS,
    keys: memberListKeys,
    strings: 29,
  },
  {
    // TEAM POSITION. SEVEN over two unions: the three position labels and the
    // unknown position (`positionMessageKey`), and the roster's three lines —
    // with a rank, with a position, with both (`rosterLineMessageKey`). Read
    // by `memberListKeys`, the extractor the rank mapping uses, because both
    // modules declare keys only as `\w*MessageKey` return unions. A mapping for
    // the rank's reason, and `position.test.ts` runs it.
    name: 'the position-to-label mapping',
    file: POSITION_KEYS,
    keys: memberListKeys,
    strings: 7,
  },
  {
    // STORY 7.8. TWO: what `Kopiraj` did — copied, or write it down.
    name: 'the credential copy mapping',
    file: CREDENTIAL_COPY_KEYS,
    keys: memberListKeys,
    strings: 2,
  },
  {
    // NINE since story 7.18 (ten from story 1.4b; no write carries a zone any
    // more, so the zone's refusal went), and one function rather than two: the surface
    // shows exactly one message region, so a second mapping would need a
    // screen-side ternary choosing between them — the executed-by-nothing
    // branch this entry exists to abolish.
    //
    // TEN SINCE 0036: a name over the maximum.
    name: 'the organization failure-to-message mapping',
    file: ORGANIZATION_MESSAGE_KEYS,
    keys: messageKeyUnion,
    strings: 10,
  },
  // SIX literal keys on the chrome — the navigation landmark's name twice (one
  // per bar), the collapse's two state-dependent names, the exit and the retry —
  // and that count is smaller than what the chrome RENDERS, which is the
  // interesting part. The eight destination labels reach `t()` as
  // `t(destination.key)`, read off `@/features/navigation/utils/destinations` rather than
  // written here, so `translationKeys` finds none of them and must not: a chrome
  // that named its own keys would be a ninth copy of the destination list, and
  // the whole reason that table is data is that a test can execute it. The eight
  // stay in the set comparison below because the eight destination screens each
  // render their own heading.
  // TEN: the theme control's name per preference (three) and its group's label
  // came in; the sidebar's muted section label, a third `shell.navigation`,
  // went out with the sidebar redesign. The profile card's role words arrive
  // through `memberRoleLabelKey`, a key this sweep does not see by design.
  // SEVENTEEN with story 7.3's *Više*: its name twice (the button's word and
  // the sheet's `aria-label`), the sheet's close, its three group headings
  // and the "role · organization" line under the person's name.
  // EIGHTEEN with the sheet's copy: the current row's "Ovdje si". The rows'
  // descriptions and the place under *Više* come through the next entry but
  // one.
  // TWENTY with story 8.4: *Instaliraj* and its iOS steps.
  // TWENTY-FOUR SINCE STORY 10.3: the fixed *Obavijesti* row — its name
  // (in the sheet and in the menu), its description, and *Ovdje si*.
  { name: 'the navigation chrome', file: CHROME, keys: translationKeys, strings: 24 },
  {
    // TWO, for three role codes and one sign-out code. The collapse is the
    // decision `messages.test.ts` executes; what this count pins is that there
    // are exactly two messages to collapse into, so a third failure that quietly
    // grew its own message has to be justified here first.
    name: 'the chrome failure-to-message mapping',
    file: NAVIGATION_MESSAGE_KEYS,
    keys: messageKeyUnion,
    strings: 2,
  },
  {
    // NINE over two unions: a description per destination key (eight), and
    // the one place *Više* names by a shorter word than the label.
    name: 'the destination copy mapping',
    file: DESTINATION_COPY_KEYS,
    keys: messageKeyUnions,
    strings: 9,
  },
  // ONE each, exactly. The seven together are what make the set comparison
  // below hold once `hr.json` gained eight `nav.*` keys: a key declared and
  // never rendered is a string nobody reviewed, and a destination rendering two
  // keys is a screen this story did not sanction.
  ...DESTINATION_SCREENS.map((destination) => ({
    ...destination,
    keys: translationKeys,
    strings: 1,
  })),
];
