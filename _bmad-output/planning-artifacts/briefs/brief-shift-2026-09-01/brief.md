---
title: "Product Brief: Shift Management Platform"
status: draft
created: 2026-09-01
updated: 2026-09-01
---

# Product Brief: Shift Management Platform

> Working name: **Shift**. Draft — items marked `[ASSUMPTION]` were inferred, not stated, and need confirmation. Open decisions are listed at the end; deeper material lives in `addendum.md`.

## Executive Summary

Organizations that run continuous operations — emergency services, security firms, care providers, plants, warehouses, hotels — all solve the same problem badly. They rotate crews through recurring shift patterns, and they manage it in spreadsheets, paper rotas, or group chats. The pattern itself lives in someone's head. Actual worked hours are reconstructed after the fact. Leave is agreed verbally and collides with the rota, and nobody notices until a shift is short.

**Shift** is an industry-agnostic shift management platform. An organization defines its own shift types, its own rotation pattern, and its own teams; the platform generates the schedule from that definition, tracks worked hours against it, manages leave entitlement, and surfaces every conflict between the two rather than resolving them silently.

The founding insight is a separation most tools blur: **the rotation pattern is a rule, the schedule is a projection of that rule, and reality is a layer of exceptions on top.** Manual changes and approved leave never rewrite the rule. That separation is what makes the platform explainable, auditable, and correct across an arbitrary number of teams and patterns.

The first pilot is a Croatian volunteer fire department (DVD) running four teams on a `DAY → NIGHT → OFF → OFF` rotation, in Croatian. It is the first tenant, not the product.

## The Problem

- **The pattern is tribal knowledge.** The rotation lives in a spreadsheet formula or a person's memory. When they are unavailable, nobody can answer "who is on nights next Tuesday?"
- **Hours are reconstructed, not recorded.** Day and night hours matter — for pay, for premiums, for statutory limits, for volunteer recognition — but they are tallied by hand from the rota after the month closes.
- **Leave and the rota are managed in different places.** Leave is approved without checking the schedule. The collision surfaces as an uncovered shift, usually on the day.
- **Off-the-shelf tools force a shape.** General scheduling SaaS is built around either fully manual shift-by-shift assignment or one hard-coded rotation model. Neither fits an organization whose entire operation *is* a fixed, offset, multi-team rotation.
- **Cost of the status quo:** uncovered shifts, disputed hours, no auditable history of who was actually scheduled and why it changed.

## The Solution

An organization is configured, not coded, along generic primitives — **Organization, Members, Teams, Shift Types, Rotation Patterns, Schedule, Hours, Leave**. From a rotation pattern plus a per-team offset, the platform generates the schedule forward; the calendar renders it filtered by all teams, one team, or one member; hours accumulate with a day/night breakdown; leave draws down a per-member allowance.

Where the schedule and reality disagree, the platform is deliberately conservative. An override records an exception without touching the pattern. Approved leave on a scheduled shift raises a visible conflict that an Admin must explicitly resolve — the shift is never silently dropped, because a silently dropped shift is an uncovered shift nobody was warned about.

## Core Principle

**This is not a fire-department scheduling app. It is a shift-management platform whose first customer is a fire department.**

Every pilot specific — four teams, `DAY/NIGHT/OFF/OFF`, 07:00–19:00, Croatian — is seed and configuration data. None of it may appear in the domain model, the schema, or the business logic. The engine takes an arbitrary number of teams, arbitrary shift types with arbitrary durations, and arbitrary pattern lengths. The pilot config is a test case, not a shape.

Consequence: rotation calculation, schedule generation, hour computation, and conflict detection are pure, testable domain logic isolated from the UI. The pilot rotation becomes a fixture, and the correctness of the engine is provable without rendering a single component.

## What Makes This Different

Honest read — there is no technical moat here:

- **Rotation-native, not shift-native.** Competitors model individual shift assignments and bolt patterns on top. Shift models the pattern as the primary object and derives assignments. For rotation-driven organizations that is the difference between fitting and fighting the tool.
- **Explicit conflicts over silent resolution.** A deliberate product stance, uncommon in this category, and directly valuable to anyone who cannot afford an unnoticed gap in coverage.
- **Configuration depth without configuration burden.** The generic engine is powerful; a new org gets a working rotation from a small number of decisions.
- **Beachhead advantage.** Croatian-language, DVD-shaped first customer in an underserved segment — a real wedge, but it is distribution and focus, not defensibility.

## Who This Serves

**Buying/operating organizations:** any org running people through recurring shifts — volunteer fire departments, security companies, healthcare, manufacturing, warehouses, hospitality, emergency services.

**Admin** — the person who currently owns the spreadsheet. Manages the organization, members, teams, rotation configuration, schedules, leave, branding; views all hours; resolves conflicts. Success: the rota is defined once and maintained in minutes, and they are warned about collisions before they happen.

**Member** — the person on the rota. Views their own dashboard, their own schedule, the calendar, their own hours, their own leave balance, and relevant org/member information. Cannot change administrative configuration. Success: an unambiguous answer to "when am I working, how much have I worked, how much leave do I have left" — `[ASSUMPTION]` primarily from a phone.

## Key Product Invariants

Non-negotiable rules the architecture must enforce, not merely permit:

1. **Rotation ≠ schedule.** The pattern is the rule; the schedule is generated from it. Generation is repeatable.
2. **Overrides never mutate the pattern.** A manual schedule change is an exception layered on the projection.
3. **Leave never mutates the pattern** and never silently removes a scheduled shift.
4. **A conflict is a first-class, visible state** requiring explicit Admin resolution.
5. **A shift is one continuous interval.** `19:00 → 07:00` is a single 12-hour shift. Midnight is not a boundary. It is never two shifts.
6. **No pilot specifics in the core.** Team count, pattern length, shift durations, and language are all data.
7. **No user-facing string is hard-coded.** Every string is a translation key; dates, times, numbers, and plurals are locale-aware.

## MVP Scope

**In:** authentication; multi-tenant organizations; organization settings and branding/logo; members; teams; configurable shift types; configurable rotation patterns; automatic schedule generation; manual schedule overrides; monthly calendar with filtering by all teams / one team / one member; worked hours with day/night/total breakdown; annual leave with per-member allowance and balance; leave–schedule conflict detection and explicit resolution; Admin and Member roles.

**Explicitly out of MVP:** shift swaps and trades between members; absence types beyond annual leave (sick, training, unpaid); minimum-coverage and staffing-level rules; notifications and reminders; payroll or timesheet export; overtime and premium-pay calculation; statutory rest-period and max-hours compliance checking; approval workflows beyond leave; reporting and analytics beyond the hours breakdown; native mobile apps; billing and subscription management; English UI (architecture ready, translation not shipped).

## Success Criteria

`[ASSUMPTION]` — not stated; needs confirmation.

- The pilot organization retires its spreadsheet: the platform is the single source of truth for the rota within one month of go-live.
- Every member can answer "when am I next working?" without asking anyone.
- Month-end hour totals are produced by the system and accepted without manual recomputation.
- Zero uncovered shifts caused by an undetected leave collision.
- A second organization — in a different industry, with a different team count and pattern — is configured without a code change. This is the real proof of the core principle.

## Open Decisions Before Architecture

Material forks, detailed in `addendum.md`:

1. **Day/night hour semantics** — whole-shift classification, or split by a statutory night window?
2. **Leave accounting unit** — calendar days, or scheduled shifts? Does leave on an OFF day draw down balance?
3. **Hours during leave** — does a shift covered by approved leave still accrue worked hours?
4. **Conflict resolution actions** — what set of resolutions does an Admin actually get?
5. **Leave request flow** — can Members request leave in MVP, or is leave Admin-entered only?
6. **Assignment model** — are shifts assigned to teams with members inheriting, or to individuals? Can a member belong to more than one team?
7. **Access and tenancy** — how do orgs get provisioned, and how do members get accounts?
8. **Timezone and DST** — how is the "night shift is always 12 hours" invariant preserved across DST transitions?

## Vision

Three years out, Shift is the default operating layer for rotation-driven organizations in the region and beyond. The rotation engine that started as four teams on a four-day cycle handles arbitrary patterns, coverage requirements, qualification and certification constraints, and multi-site organizations. Hours flow into payroll. Compliance rules — rest periods, maximum hours — are checked as schedules are generated rather than audited afterward. Members swap shifts from their phones within rules the Admin sets once.

The wedge is a Croatian volunteer fire department that needs its rota to stop living in a spreadsheet. The platform is every organization that has the same problem and has never been offered a tool shaped like their actual operation.
