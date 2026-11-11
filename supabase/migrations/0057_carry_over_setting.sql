-- 0057_carry_over_setting.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 13.4: the carry-over setting (CAP-23, R4.13–R4.15).
--
-- Four columns on `organizations`, and nothing else: the most days that carry
-- into a leave year, the day and month on which they expire, and the first
-- leave year carried INTO. Nothing is derived from them here, and nothing
-- stores a carried figure: `packages/domain/leave` derives carried days, their
-- expiry and the balance on read (AD-1, AD-7; story 13.4b).
--
-- NULLABLE, WITH NO DEFAULT (DI-8). All four null is "no carry-over". Local
-- practice often expires carried days on 30.06., but that is one
-- organization's answer, and `0002:38-41` forbids a default that encodes it.
-- Neither `seed.sql` nor the demo sets it.
--
-- ALL FOUR OR NONE, by a named check: a cap with no expiry, or an expiry with no
-- first year, is a setting the domain could not read.
--
-- THE EXPIRY IS A DAY AND A MONTH, never a date: it recurs every leave year.
-- The day is refused beyond its month's last day, with February at 28, so
-- 30.06. fits and 31.06. and 29.02. do not. Which year an expiry falls in is
-- the domain's (13.4b): the first such day on or after the leave year's start.
--
-- THE FIRST LEAVE YEAR is the calendar year in which that leave year begins,
-- 1–9999 like `leave_allowances.leave_year` (`0055`). Nothing carries into an
-- earlier year, so the years before the organization used the app carry nothing.
--
-- CURRENT-STATE (AD-2, amended by story 13.4): no history and no versions, like
-- minimum members, so a change re-derives every balance (R4.15).

alter table public.organizations
  add column carry_over_max_days smallint
    constraint organizations_carry_over_max_days_check check (carry_over_max_days >= 1),
  add column carry_over_expiry_month smallint
    constraint organizations_carry_over_expiry_month_check
      check (carry_over_expiry_month between 1 and 12),
  add column carry_over_expiry_day smallint,
  add column carry_over_first_leave_year smallint
    constraint organizations_carry_over_first_leave_year_check
      check (carry_over_first_leave_year between 1 and 9999);

-- The day against its month: a table check, because it reads two columns.
-- A null month leaves only the range, and the all-or-none check below refuses
-- the row anyway.
alter table public.organizations
  add constraint organizations_carry_over_expiry_day_check check (
    carry_over_expiry_day between 1 and (
      case
        when carry_over_expiry_month = 2 then 28
        when carry_over_expiry_month in (4, 6, 9, 11) then 30
        else 31
      end
    )
  );

alter table public.organizations
  add constraint organizations_carry_over_all_or_none check (
    (
      carry_over_max_days is null
      and carry_over_expiry_month is null
      and carry_over_expiry_day is null
      and carry_over_first_leave_year is null
    )
    or (
      carry_over_max_days is not null
      and carry_over_expiry_month is not null
      and carry_over_expiry_day is not null
      and carry_over_first_leave_year is not null
    )
  );

-- JOINS the column grants, as `0048`'s `minimum_members` did: column grants are
-- unioned, so this adds four writable columns and leaves every other exactly as
-- it was. WHO may write them is 0004's `organizations_update_by_own_active_admin`,
-- unchanged.
grant update (
  carry_over_max_days,
  carry_over_expiry_month,
  carry_over_expiry_day,
  carry_over_first_leave_year
) on table public.organizations to authenticated;
