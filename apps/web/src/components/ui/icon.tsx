import type { ComponentType, Ref, SVGProps } from "react"

import archive from "@phosphor-icons/core/fill/archive-fill.svg?raw"
import arrowDown from "@phosphor-icons/core/fill/arrow-down-fill.svg?raw"
import arrowLeft from "@phosphor-icons/core/fill/arrow-left-fill.svg?raw"
import arrowRight from "@phosphor-icons/core/fill/arrow-right-fill.svg?raw"
import arrowUUpLeft from "@phosphor-icons/core/fill/arrow-u-up-left-fill.svg?raw"
import arrowUp from "@phosphor-icons/core/fill/arrow-up-fill.svg?raw"
import arrowsDownUp from "@phosphor-icons/core/fill/arrows-down-up-fill.svg?raw"
import at from "@phosphor-icons/core/fill/at-fill.svg?raw"
import bell from "@phosphor-icons/core/fill/bell-fill.svg?raw"
import briefcase from "@phosphor-icons/core/fill/briefcase-fill.svg?raw"
import buildings from "@phosphor-icons/core/fill/buildings-fill.svg?raw"
import calendarBlank from "@phosphor-icons/core/fill/calendar-blank-fill.svg?raw"
import calendarDots from "@phosphor-icons/core/fill/calendar-dots-fill.svg?raw"
import calendar from "@phosphor-icons/core/fill/calendar-fill.svg?raw"
import calendarPlus from "@phosphor-icons/core/fill/calendar-plus-fill.svg?raw"
import caretDown from "@phosphor-icons/core/fill/caret-down-fill.svg?raw"
import caretLeft from "@phosphor-icons/core/fill/caret-left-fill.svg?raw"
import caretLineLeft from "@phosphor-icons/core/fill/caret-line-left-fill.svg?raw"
import caretLineRight from "@phosphor-icons/core/fill/caret-line-right-fill.svg?raw"
import caretRight from "@phosphor-icons/core/fill/caret-right-fill.svg?raw"
import caretUp from "@phosphor-icons/core/fill/caret-up-fill.svg?raw"
import checkCircleBold from "@phosphor-icons/core/bold/check-circle-bold.svg?raw"
import checkCircle from "@phosphor-icons/core/fill/check-circle-fill.svg?raw"
import check from "@phosphor-icons/core/fill/check-fill.svg?raw"
import circleDashedBold from "@phosphor-icons/core/bold/circle-dashed-bold.svg?raw"
import clipboardText from "@phosphor-icons/core/fill/clipboard-text-fill.svg?raw"
import clockCounterClockwise from "@phosphor-icons/core/fill/clock-counter-clockwise-fill.svg?raw"
import clockBold from "@phosphor-icons/core/bold/clock-bold.svg?raw"
import clockCountdown from "@phosphor-icons/core/fill/clock-countdown-fill.svg?raw"
import clock from "@phosphor-icons/core/fill/clock-fill.svg?raw"
import coffee from "@phosphor-icons/core/fill/coffee-fill.svg?raw"
import copy from "@phosphor-icons/core/fill/copy-fill.svg?raw"
import dotsSixVertical from "@phosphor-icons/core/fill/dots-six-vertical-fill.svg?raw"
import dotsThree from "@phosphor-icons/core/fill/dots-three-fill.svg?raw"
import downloadSimple from "@phosphor-icons/core/fill/download-simple-fill.svg?raw"
import envelope from "@phosphor-icons/core/fill/envelope-fill.svg?raw"
import eye from "@phosphor-icons/core/fill/eye-fill.svg?raw"
import eyeSlash from "@phosphor-icons/core/fill/eye-slash-fill.svg?raw"
import floppyDisk from "@phosphor-icons/core/fill/floppy-disk-fill.svg?raw"
import house from "@phosphor-icons/core/fill/house-fill.svg?raw"
import info from "@phosphor-icons/core/fill/info-fill.svg?raw"
import key from "@phosphor-icons/core/fill/key-fill.svg?raw"
import lock from "@phosphor-icons/core/fill/lock-fill.svg?raw"
import magnifyingGlass from "@phosphor-icons/core/fill/magnifying-glass-fill.svg?raw"
import medal from "@phosphor-icons/core/fill/medal-fill.svg?raw"
import monitor from "@phosphor-icons/core/fill/monitor-fill.svg?raw"
import moon from "@phosphor-icons/core/fill/moon-fill.svg?raw"
import paperPlaneRight from "@phosphor-icons/core/fill/paper-plane-right-fill.svg?raw"
import pencilSimple from "@phosphor-icons/core/fill/pencil-simple-fill.svg?raw"
import plus from "@phosphor-icons/core/fill/plus-fill.svg?raw"
import recordBold from "@phosphor-icons/core/bold/record-bold.svg?raw"
import repeat from "@phosphor-icons/core/fill/repeat-fill.svg?raw"
import rows from "@phosphor-icons/core/fill/rows-fill.svg?raw"
import shieldCheck from "@phosphor-icons/core/fill/shield-check-fill.svg?raw"
import signOut from "@phosphor-icons/core/fill/sign-out-fill.svg?raw"
import sun from "@phosphor-icons/core/fill/sun-fill.svg?raw"
import trash from "@phosphor-icons/core/fill/trash-fill.svg?raw"
import treePalm from "@phosphor-icons/core/fill/tree-palm-fill.svg?raw"
import uploadSimple from "@phosphor-icons/core/fill/upload-simple-fill.svg?raw"
import user from "@phosphor-icons/core/fill/user-fill.svg?raw"
import users from "@phosphor-icons/core/fill/users-fill.svg?raw"
import usersThree from "@phosphor-icons/core/fill/users-three-fill.svg?raw"
import warningCircle from "@phosphor-icons/core/fill/warning-circle-fill.svg?raw"
import warning from "@phosphor-icons/core/fill/warning-fill.svg?raw"
import wifiSlash from "@phosphor-icons/core/fill/wifi-slash-fill.svg?raw"
import x from "@phosphor-icons/core/fill/x-fill.svg?raw"

/**
 * THE ONE ICON MODULE (story 15.1, D2). Every icon the application draws is
 * named here, and this is the only file that imports an icon library —
 * `eslint.config.js` refuses `lucide-react` and `@phosphor-icons/*` anywhere
 * else under `apps/web/src`. A library swap is a change to this file and to no
 * screen.
 *
 * PHOSPHOR'S `fill` WEIGHT, as direction G draws them — with ONE exception,
 * the small STATUS MARKS (human decision 2026-10-30): the calendar's leave and
 * uncovered marks and *Danas*'s duty-block leg states are Phosphor `bold`,
 * exported under their own `…Bold` names. Their fill shapes are solid discs
 * whose 16/256-unit knockouts vanish at 12 px, so two marks that must be told
 * apart by shape drew as the same dot; the bold outlines stay apart, which
 * `test/typography-coverage.test.ts` proves on the rasterized marks. The pilot
 * measured `@phosphor-icons/react` first: every one of its icon modules carries
 * all six weights in a runtime `Map`, and the main chunk grew 31.3 KB gzip
 * over lucide's, past D2's 15 KB line. So, as D2 decided, the facade draws the
 * fill (and the few bold) SVGs of `@phosphor-icons/core` itself: each file is
 * imported as text (`?raw`), its path data is read once at module load, and
 * one small component draws it. No markup is injected — the paths are React
 * elements — and the weight is not a prop a screen can pass. A file that holds
 * anything but `<path d>` elements THROWS at module load (in every test that
 * imports this module, and on the app's first load), so a circle or a group
 * can never be dropped silently.
 *
 * Each carries `data-icon="<kebab-name>"`, the stable hook a test or an e2e
 * locator finds an icon by (`[data-icon="clock"]`). An icon is decoration
 * beside words that carry the meaning, so it is `aria-hidden` unless the caller
 * names it (`aria-label` or `aria-labelledby`), as lucide-react behaved before
 * it. Size comes from the caller's class (`size-4`); with none it is `1em`,
 * the text size around it.
 *
 * The names are Phosphor's own. The lucide names they replaced, for the
 * record: TriangleAlert → Warning, CircleAlert → WarningCircle, CircleCheck →
 * CheckCircle (CheckCircleBold as a duty leg), CircleDot → RecordBold, Clock3 → Clock, WifiOff → WifiSlash,
 * GripVertical → DotsSixVertical, Chevron* → Caret*, PanelLeftClose/Open →
 * CaretLineLeft/Right, ArrowUpDown → ArrowsDownUp, AtSign → At,
 * BriefcaseBusiness → Briefcase, Building2 → Buildings, CalendarClock →
 * CalendarBlank (the sign-in mark) or ClockCountdown (a scheduled change),
 * CalendarDays → CalendarDots, CalendarRange → CalendarDots,
 * ClipboardCheck → ClipboardText, Download → DownloadSimple, Ellipsis →
 * DotsThree, EyeOff → EyeSlash, History → ClockCounterClockwise, Home → House,
 * KeyRound → Key, LogOut → SignOut, Mail → Envelope, MoveRight → ArrowRight,
 * Pencil → PencilSimple, Rows3 → Rows, Save → FloppyDisk, Search →
 * MagnifyingGlass, Send → PaperPlaneRight, Trash2 → Trash, Undo2 →
 * ArrowUUpLeft, Upload → UploadSimple, UsersRound → UsersThree. The rest kept
 * their name. Leave (`ClockBold`) and uncovered (`CircleDashedBold`) are told
 * apart by drawn shape: a ring with a clock's hands against a dashed ring.
 */

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children" | "ref" | "dangerouslySetInnerHTML"> & {
  readonly ref?: Ref<SVGSVGElement>
}
export type IconComponent = ComponentType<IconProps>

/** The one shape a Phosphor core file may have: the 256 viewBox, then paths only. */
const SVG_SHELL =
  /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 256 256" fill="currentColor">((?:<path d="[^"]+"\/>)+)<\/svg>\s*$/

/** Every `d` in one Phosphor file, which must hold `<path d="…"/>` and nothing else. */
export function pathsOf(svg: string, name: string): readonly string[] {
  const body = SVG_SHELL.exec(svg)?.[1]

  if (body === undefined) throw new Error(`ICON_NOT_PATHS_ONLY: ${name}`)

  return [...body.matchAll(/<path d="([^"]+)"\/>/g)].map((found) => found[1] ?? "")
}

function glyph(svg: string, name: string): IconComponent {
  const paths = pathsOf(svg, name)

  function FillIcon(props: IconProps) {
    const named = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined

    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width="1em"
        height="1em"
        fill="currentColor"
        aria-hidden={named ? undefined : true}
        data-icon={name}
        {...props}
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    )
  }
  FillIcon.displayName = `Icon(${name})`

  return FillIcon
}

export const Archive = glyph(archive, "archive")
export const ArrowDown = glyph(arrowDown, "arrow-down")
export const ArrowLeft = glyph(arrowLeft, "arrow-left")
export const ArrowRight = glyph(arrowRight, "arrow-right")
export const ArrowUp = glyph(arrowUp, "arrow-up")
export const ArrowUUpLeft = glyph(arrowUUpLeft, "arrow-u-up-left")
export const ArrowsDownUp = glyph(arrowsDownUp, "arrows-down-up")
export const At = glyph(at, "at")
export const Bell = glyph(bell, "bell")
export const Briefcase = glyph(briefcase, "briefcase")
export const Buildings = glyph(buildings, "buildings")
export const Calendar = glyph(calendar, "calendar")
export const CalendarBlank = glyph(calendarBlank, "calendar-blank")
export const CalendarDots = glyph(calendarDots, "calendar-dots")
export const CalendarPlus = glyph(calendarPlus, "calendar-plus")
export const CaretDown = glyph(caretDown, "caret-down")
export const CaretLeft = glyph(caretLeft, "caret-left")
export const CaretLineLeft = glyph(caretLineLeft, "caret-line-left")
export const CaretLineRight = glyph(caretLineRight, "caret-line-right")
export const CaretRight = glyph(caretRight, "caret-right")
export const CaretUp = glyph(caretUp, "caret-up")
export const Check = glyph(check, "check")
export const CheckCircle = glyph(checkCircle, "check-circle")
export const ClipboardText = glyph(clipboardText, "clipboard-text")
export const Clock = glyph(clock, "clock")
export const ClockCountdown = glyph(clockCountdown, "clock-countdown")
export const ClockCounterClockwise = glyph(clockCounterClockwise, "clock-counter-clockwise")
export const Coffee = glyph(coffee, "coffee")
export const Copy = glyph(copy, "copy")
export const DotsSixVertical = glyph(dotsSixVertical, "dots-six-vertical")
export const DotsThree = glyph(dotsThree, "dots-three")
export const DownloadSimple = glyph(downloadSimple, "download-simple")
export const Envelope = glyph(envelope, "envelope")
export const Eye = glyph(eye, "eye")
export const EyeSlash = glyph(eyeSlash, "eye-slash")
export const FloppyDisk = glyph(floppyDisk, "floppy-disk")
export const House = glyph(house, "house")
export const Info = glyph(info, "info")
export const Key = glyph(key, "key")
export const Lock = glyph(lock, "lock")
export const MagnifyingGlass = glyph(magnifyingGlass, "magnifying-glass")
export const Medal = glyph(medal, "medal")
export const Monitor = glyph(monitor, "monitor")
export const Moon = glyph(moon, "moon")
export const PaperPlaneRight = glyph(paperPlaneRight, "paper-plane-right")
export const PencilSimple = glyph(pencilSimple, "pencil-simple")
export const Plus = glyph(plus, "plus")
export const Repeat = glyph(repeat, "repeat")
export const Rows = glyph(rows, "rows")
export const ShieldCheck = glyph(shieldCheck, "shield-check")
export const SignOut = glyph(signOut, "sign-out")
export const Sun = glyph(sun, "sun")
export const Trash = glyph(trash, "trash")
export const TreePalm = glyph(treePalm, "tree-palm")
export const UploadSimple = glyph(uploadSimple, "upload-simple")
export const User = glyph(user, "user")
export const Users = glyph(users, "users")
export const UsersThree = glyph(usersThree, "users-three")
export const Warning = glyph(warning, "warning")
export const WarningCircle = glyph(warningCircle, "warning-circle")
export const WifiSlash = glyph(wifiSlash, "wifi-slash")
export const X = glyph(x, "x")

// THE STATUS MARKS, in Phosphor `bold` (story 15.1, human decision
// 2026-10-30): the calendar's leave and uncovered marks (and the consequence
// strip's uncovered coverage, which is the same mark) and the duty block's
// three leg states. Nothing but a status mark takes these.
export const CheckCircleBold = glyph(checkCircleBold, "check-circle-bold")
export const CircleDashedBold = glyph(circleDashedBold, "circle-dashed-bold")
export const ClockBold = glyph(clockBold, "clock-bold")
export const RecordBold = glyph(recordBold, "record-bold")
