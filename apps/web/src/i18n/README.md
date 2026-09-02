# `i18n/`

The localization layer, built once (story 1.1b): i18next resource files with ICU
messages, plus the single locale-aware formatting module that produces every
date, time, number, month and day name and plural — including Croatian's three
plural forms, where a `count === 1` check is a defect.

Adding a language means adding a resource file and changing no component and no
logic. A missing key degrades visibly, never to a blank screen or a crash.
Terminology is binding: `Smjena` = Team, `Tip smjene` = Shift Type. Band,
shift-type and team names are admin-entered data, never keys.
