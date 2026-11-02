---
title: 'A red main blocks merges: one required check, CI passed (retro 10 A12)'
type: 'chore'
created: '2026-11-02'
status: 'done'
route: 'one-shot'
---

# A red main blocks merges: one required check, CI passed (retro 10 A12)

## Intent

**Problem:** `main` had no branch protection, so a PR could merge on top of a red `main` (c16220a, retro 10 P1). The steps #250 left for the owner required the four E2E shards by name. That cannot work: on a docs-only PR the skipped matrix job reports as `E2E (Playwright, shard ${{ matrix.shard }}/4)` (seen on #255), so a required `shard 1/4` never reports and the PR waits forever. The time-of-day flake half of A12 shipped in #250 but was never run inside its 00:00–06:00 window.

**Approach:** A `ci-passed` gate job (check name **CI passed**) that always runs and fails when any job in its `needs` failed, was cancelled or was skipped, except `e2e` skipped on a docs-only PR. Branch protection requires that one check, up to date with `main`. DEPLOY.md §8 documents the rule, and the superseded #250 steps and the deferred-work entry are marked. The flake fix is verified by running `e2e/tests/today/today.spec.ts` locally after 00:00 organization time.

## Suggested Review Order

1. [The gate job and why it reads `needs` whole](../../.github/workflows/pipeline.yml) — `ci-passed`, after `e2e-report`; the jq filter is the whole logic.
2. [The rule, as documented](../../DEPLOY.md) — §8, the `ci-passed` row and *Branch protection on `main`*.
3. [Superseded owner steps](spec-retro-10-batch-open-items.md) — the Branch protection bullet.
4. [Deferred entry marked resolved](deferred-work.md) — the branch protection entry from the 2026-10-13 sweep.
