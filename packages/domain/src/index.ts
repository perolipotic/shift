/**
 * The pure scheduling engine (AD-7).
 *
 * Zero runtime dependencies: projection, rosters, bands, hours, leave,
 * collisions and warnings all land here from Epic 2 onward. Nothing in this
 * package may import React, the Supabase client, or any other runtime package —
 * `packages/domain/package.json` declares no `dependencies`, so such an import
 * is an unresolvable module and fails the build.
 *
 * The engine returns keys, codes and values only — never a formatted or
 * translated string.
 */

export {
  MINUTES_PER_DAY,
  deriveHourBands,
  partitionOfDay,
  type DayPartition,
  type DaySegment,
  type HourBand,
  type HourBandWindow,
} from './bands.js';

export {
  deriveShiftTimes,
  shiftDurationOn,
  shiftTypeVersionOn,
  type ShiftTimes,
  type ShiftType,
  type ShiftTypeVersion,
} from './duration.js';

export {
  memberHoursOfMonth,
  type BandHours,
  type MemberHours,
  type MemberHoursInput,
  type ShiftTypeWithVersions,
} from './hours.js';

export {
  daysBetween,
  projectedShiftType,
  projectedShiftTypeOn,
  projectedStepId,
  rotationAssignmentOn,
  type RotationAssignment,
  type RotationPattern,
  type RotationStep,
} from './projection.js';

export {
  overrideStandingOf,
  overridesByTeamAndDate,
  scheduledShiftTypeOn,
  type OverrideStanding,
  type RotationVersionStamp,
  type ScheduledShiftType,
  type ShiftTypeOverride,
  type StampedOverride,
  type StampedShiftTypeOverride,
} from './overrides.js';

export {
  COVERAGE_GAP,
  DUPLICATE_COVERAGE,
  REST_GAP,
  rotationWarningsOf,
  type CoverageGapWarning,
  type DuplicateCoverageWarning,
  type RestGapWarning,
  type RotationWarning,
  type RotationWarningInput,
  type WarningDate,
} from './warnings.js';

export {
  adjacentMonth,
  datesOfMonth,
  memberScheduleOfMonth,
  monthOf,
  scheduleOfMonth,
  type MemberScheduleDay,
  type MemberScheduleInput,
  type MemberShift,
  type ScheduleCell,
  type ScheduleInput,
  type ScheduleRow,
} from './schedule.js';

export {
  activeOn,
  checkRosterOverrides,
  membershipOn,
  rosterOn,
  shiftRoster,
  type MembershipOn,
  type MembershipVersion,
  type RosterEntry,
  type RosterMember,
  type RosterOnDate,
  type RosterOnEntry,
  type RosterOverride,
  type StatusVersion,
} from './roster.js';
