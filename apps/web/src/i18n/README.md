# `i18n/`

The localization layer, built once (story 1.1c): i18next resource files with ICU
messages, plus the single locale-aware formatting module that produces every
date, time, number, month and day name and plural — including Croatian's three
plural forms, where a `count === 1` check is a defect.

Adding a language means adding a resource file and changing no component and no
logic. A missing key degrades visibly, never to a blank screen or a crash.
Terminology is binding: `Smjena` = Team, `Tip smjene` = Shift Type. Band,
shift-type and team names are admin-entered data, never keys.

`format.ts` is the only place in `apps/web` that may construct an `Intl`
formatter, and every date/time entry point there takes a required IANA
`timeZone` — the organization's, never the device's (L8). `index.ts` owns the
i18next instance; `locales/hr.json` holds the messages. Screen literals belong
in that resource file, and `eslint.config.js` refuses one written into a
component (L2).
