---
title: 'Story 20.4: The host is closed to everything but the web (scripts only)'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: '888752be3a45740ed96d6e98aa8896d7085b5e56'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-20-self-hosting.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The server that will run every Shift stack exposes more than HTTPS: Docker-published ports bypass any INPUT firewall, sshd accepts passwords and root passwords, there is no swap, and Coolify updates itself at night (proposal §1.3, H-2–H-5, H-10, H-15).

**Approach:** Ship, in `deploy/host/`, idempotent and reviewable scripts and units that close the host (own `SHIFT-*` chains jumped first from `INPUT` and `DOCKER-USER`, IPv4 and IPv6), harden sshd, add swap, pin the update policy and turn Coolify auto-update off, with a read-only plan mode, a timed auto-revert, and an outside verification script; plus DEPLOY.md's runbook. Nothing is applied: the founder has not given the go.

## Boundaries & Constraints

**Always:** plan (read-only) is the default mode; anything that changes the host needs `apply` and root. Firewall and sshd are applied together under a transient systemd revert timer (default 300 s) that undoes them unless `confirm` runs; the boot unit is enabled only by `confirm`, so a reboot before it also reverts the firewall. Only our own chains and files are written; Docker's chains and the existing dev-stack `DOCKER-USER` drop are never edited. Rules match the ORIGINAL destination port (`--ctorigdstport`), because `DOCKER-USER` sees packets after DNAT. Every host-specific value (interfaces, SSH port, Coolify network) is a variable; the Coolify bridge and subnets are resolved from `docker network inspect` at apply time.

**Ask First:** applying any of it on any host; any change to the stack compose or a migration.

**Never:** run these scripts, or change iptables, sshd, systemd, swap, apt or Coolify on this machine; commit this host's addresses, interface names, ports, tailnet or SSH settings; restore a whole saved ruleset on revert (it would clobber Docker's rules made since); tests that execute the scripts (they parse files only).

**Required inputs (deferred-work.md, OWNER 20.4) and their answers:**
- *Docker Engine < 28 exposes 127.0.0.1-bound ports to the L2 segment* → both: `SHIFT-DOCKER-USER` drops forwarded traffic from the public interface whose original destination is `127.0.0.0/8` / `::1`, and plan warns below Engine 28; DEPLOY states 28 as the minimum. Resolved in the repo; enforced when applied.
- *pg-meta unauthenticated on the stack network; pg_net callable by anon/authenticated* → not a host-firewall matter (container-to-container traffic never crosses `eth0`). Decision: the forward-only `REVOKE EXECUTE ON net.http_get/http_post FROM anon, authenticated` migration is **its own story** (a schema change with its own CI DB proof, independent of the host go); the pg-meta/Studio network split goes to **20.5**, which can see how Coolify v4.7.6 treats compose `networks:`. Both recorded as new deferred entries.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plan | `shift-host.sh` (no args) as root | prints each component's state and the commands it would run; changes nothing | — |
| Apply twice | `apply` on an already-hardened host | same rules, one jump each, no duplicate fstab line, no second swapfile | — |
| No console | `apply firewall` with `SSH_CONNECTION` set | refused | `--allow-ssh-session` overrides |
| Lockout | apply, then no `confirm` within the window | timer runs `revert`: jumps and chains removed (both families), the drop-in removed, sshd reloaded | revert is also a manual command |
| Coolify missing | `coolify` network absent | firewall apply refused (SSH rule would cut Coolify off) | — |
| No root key | `/root/.ssh/authorized_keys` without a key | sshd apply refused | — |
| Bad drop-in | `sshd -t` fails | drop-in removed at once, apply fails | — |

## Epic AC Deviations

- *"When they are applied … applied from the provider's console with a timed auto-revert"*, *"sshd -T shows … and Coolify still validates its server connection"*, *"a 4 GiB swapfile is active …"*, *"a port scan … only 80 and 443 answer"*: **DEFERRED** to the application of 20.4 (the founder's go, console access, a `security-review` of the rules). This change ships the scripts, the checks they run on themselves and the runbook; the founder's brief forbids applying them here. Deferred entry written.
- *"INPUT admits sshd only from tailscale0 and Coolify's Docker bridge"*: **widened**. `SHIFT-INPUT` also drops every other new connection on the public interface (keeping established, ICMP, DHCP, Tailscale's UDP port, 80, 443), because the AC's own port scan would otherwise find any host listener, and a `[::]` port served by Docker's userland proxy arrives on INPUT.
- *"from `eth0`"*: the interface is the variable `PUBLIC_IF` (default `eth0`), so no host's name is committed.
- *"the monthly maintenance window is written down"*: DEPLOY §9.8 proposes a window for the founder to ratify with H-10; it is not decided here.
- *"INPUT admits sshd only from tailscale0 and Coolify's Docker bridge"*: **widened by `lo`** as well. A local connection to sshd never crosses an interface the internet can reach, and dropping it would break local tooling for nothing. (Added in review, 2026-11-21.)
- *"the Coolify UI, Studio and Postgres answer over the tailnet"*: **DEFERRED in part to 20.5.** Studio and Postgres are on the tailnet only once 20.5 has stood a stack up behind `tailscale serve`, so 20.4's verification proves the Coolify UI and SSH over the tailnet, and 20.5 runs `verify-exposure.sh` again with `--studio-url` and `--postgres-port`. Recorded in the application's deferred entry. (Added in review, 2026-11-21.)

</frozen-after-approval>

## Code Map

- `deploy/host/` -- new: the whole story (script, rule templates, the firewall and revert-at-boot units, drop-ins, verification).
- `test/self-hosted-stack.test.ts:911` -- its public-repository pin over `deploy/` and DEPLOY §9: allows the loopback network `127.0.0.0` (the drop rule), and names no outside host.
- `deploy/coolify/supabase/docker-compose.yml` -- read only: Postgres and Studio publish on `127.0.0.1` (20.1); Traefik owns 80/443.
- `test/self-hosted-stack.test.ts:1-60` -- style for a structural, file-parsing test.
- `.github/workflows/pipeline.yml:62-89` -- `quality` job; gains a ShellCheck step (preinstalled on `ubuntu-24.04`).
- `DEPLOY.md` §9 (ends with §9.7 at :2172) -- gains §9.8, the host runbook.
- `_bmad-output/implementation-artifacts/deferred-work.md:1621,1630` -- the two OWNER 20.4 entries.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/host/shift-host.sh` -- modes `plan|apply|confirm|revert|status|render|boot`, components `firewall sshd swap upgrades coolify` -- one reviewable entry point; every mutation goes through `run`.
- [x] `deploy/host/firewall/shift-v4.rules`, `shift-v6.rules` -- `iptables-restore --noflush` templates with `@NAME@` placeholders -- rules reviewable as data.
- [x] `deploy/host/systemd/shift-host-firewall.service` -- oneshot after Docker and tailscaled, `PartOf=docker.service`.
- [x] `deploy/host/sshd/00-shift-hardening.conf`, `sysctl/99-shift-swap.conf`, `apt/52shift-unattended-upgrades`, `host.env.example`.
- [x] `deploy/host/verify-exposure.sh` -- run from outside: full TCP scan of v4 and v6 shows only 80/443; tailnet checks for Coolify, Studio, Postgres and SSH.
- [x] `test/host-hardening.test.ts` -- parse every file above (rule order, both families, ctorigdstport, scoping, unit ordering, drop-in sort order, no `run`-less mutation, no committed address).
- [x] `.github/workflows/pipeline.yml` -- ShellCheck `deploy/host/*.sh`.
- [x] `DEPLOY.md` §9.8 -- the founder's apply steps, confirm/revert, verification, maintenance window.
- [x] `deferred-work.md`, `sprint-status.yaml` -- mark the two entries, add the two new ones, set 20.4 to review.

**Acceptance Criteria:**
- Given the rendered rules, when read, then `SHIFT-DOCKER-USER` (v4 and v6) returns established and original ports 80/tcp, 443/tcp, 443/udp from the public interface and drops the rest from it, and `SHIFT-INPUT` admits the SSH port only from lo, the tailnet interface and the Coolify bridge/subnet, and from the public interface only established, ICMP, DHCP, Tailscale's UDP port, 80 and 443.
- Given the drop-in, when sorted with `50-cloud-init.conf` and `60-cloudimg-settings.conf`, then it comes first and sets `PasswordAuthentication no` and `PermitRootLogin prohibit-password`; apply checks `sshd -T` shows both.
- Given `apply swap upgrades coolify`, then a 4 GiB swapfile is active with `vm.swappiness=10`, unattended upgrades stay on with `Automatic-Reboot "false"`, and Coolify's `is_auto_update_enabled` is false.

## Spec Change Log

- **2026-11-21, review loop 1 (patch findings; no bad_spec loopback).** Triggers: the verification-gap layer found that `render_family` died on the `@NAME@` in the IPv4 template's own header comment, so `render`, `plan`, `apply firewall` and `boot` could never work, and no test rendered a template; the blind and edge-case layers found that `revert` removed a confirmed firewall when only sshd was pending, that an unconfirmed re-apply reverted to an open host, that a reboot before `confirm` left the sshd change in place, and about twenty smaller gaps. Amended: render skips comments; the firewall templates and host.env are staged at apply and promoted only by `confirm`, which first checks what is in force; `revert` restores the last confirmed state, only for what was pending, and runs to the end; a `shift-host-revert-at-boot.service` does the same at boot; and further guards (interfaces, Tailscale's `ts-*` jumps, `-C` checks of the live rules, `-w`, the sshd ancestry check, `/run/sshd`, Docker held from unattended upgrades, Coolify's `AUTOUPDATE`, swap size). The epic-AC layer's two unlisted deviations (`lo`, Studio/Postgres waiting for 20.5) were added to `## Epic AC Deviations`, inside the frozen block, for the founder to see. The matrix's Lockout row still holds for a first apply (the last confirmed state is then "none"). KEEP: rules as data in two templates, RETURN never ACCEPT, `--ctorigdstport`, own chains only, the revert armed before anything changes, tests that never execute the scripts.

## Design Notes

Own chains keep idempotency trivial: create if missing, flush, `iptables-restore --noflush` the rendered appends, then ensure exactly one jump first (after Tailscale's own `ts-*` jumps). Flush-then-load is fail-open for milliseconds, never fail-closed. Revert touches only our chains, files and units, so it is safe after Docker has changed its own chains, and it goes back to the last confirmed state, not to an open host. INPUT is filtered on IPv6 too because a port Docker publishes on `[::]` through its userland proxy arrives on INPUT, not FORWARD.

Tests never run the scripts (the founder's rule); instead `test/host-hardening.test.ts` ports the renderer's rule to TypeScript and renders the real templates with sample values, pins every rule in order, and fails on any line that changes the host outside `run` or a helper that checks `APPLY` (checked by injecting three such lines, each caught).

## Verification

**Commands:**
- `pnpm exec vitest run test/host-hardening.test.ts test/resource-hygiene.test.ts test/self-hosted-stack.test.ts test/ci-scripts.test.ts` -- expected: pass (the founder's allowed set plus the new file).
- `uvx --from shellcheck-py shellcheck deploy/host/*.sh` -- expected: clean.
- `pnpm typecheck && pnpm lint` -- expected: pass.

**Manual checks:** nothing is applied on any host; applying is the founder's go (DEPLOY §9.8), preceded by a `security-review` of the rules.

## Suggested Review Order

**The rules (what the security-review reads first)**

- The published-port policy: original destination port, public interface only, loopback dropped.
  [`shift-v4.rules:37`](../../deploy/host/firewall/shift-v4.rules#L37)

- SSH admitted from lo, the tailnet and Coolify's bridge; dropped from everywhere else.
  [`shift-v4.rules:23`](../../deploy/host/firewall/shift-v4.rules#L23)

- IPv6: the same policy, ICMPv6 first so neighbour discovery survives.
  [`shift-v6.rules:1`](../../deploy/host/firewall/shift-v6.rules#L1)

**Applying safely: arm first, confirm checks, revert to last confirmed**

- Records state, installs the revert copy, arms timer and boot unit before any change.
  [`shift-host.sh:773`](../../deploy/host/shift-host.sh#L773)

- Guards: SSH session, pending change; then the components.
  [`shift-host.sh:974`](../../deploy/host/shift-host.sh#L974)

- Confirm verifies live rules and sshd -T before promoting staged files.
  [`shift-host.sh:812`](../../deploy/host/shift-host.sh#L812)

- Revert restores only what was pending, to the last confirmed state, and runs to the end.
  [`shift-host.sh:841`](../../deploy/host/shift-host.sh#L841)

- The boot-time way back, when a reboot loses the transient timer.
  [`shift-host-revert-at-boot.service:16`](../../deploy/host/systemd/shift-host-revert-at-boot.service#L16)

**Loading the rules**

- Renders comments-free; a leftover placeholder is fatal, never a wider rule.
  [`shift-host.sh:330`](../../deploy/host/shift-host.sh#L330)

- Own chains flushed and loaded in one restore; jumps first (after Tailscale's).
  [`shift-host.sh:432`](../../deploy/host/shift-host.sh#L432)

- "In force" means every rendered rule passes `-C` and counts match.
  [`shift-host.sh:401`](../../deploy/host/shift-host.sh#L401)

- Refuses a wrong public interface, missing tailnet or Coolify bridge; names unfiltered NICs.
  [`shift-host.sh:279`](../../deploy/host/shift-host.sh#L279)

- Console-only apply: sshd among the ancestors counts as SSH.
  [`shift-host.sh:307`](../../deploy/host/shift-host.sh#L307)

**sshd, swap, upgrades, Coolify**

- Key-only drop-in named 00- so it wins over cloud-init's 50-.
  [`00-shift-hardening.conf:13`](../../deploy/host/sshd/00-shift-hardening.conf#L13)

- Refuses without a root key; `sshd -t`/`-T` gate, taken back on failure.
  [`shift-host.sh:562`](../../deploy/host/shift-host.sh#L562)

- Boot unit reloads the confirmed rules after Docker, restarted with it.
  [`shift-host-firewall.service:22`](../../deploy/host/systemd/shift-host-firewall.service#L22)

**Verification and runbook**

- Outside scan: all TCP ports and common UDP, both families, exactly 80/443.
  [`verify-exposure.sh:99`](../../deploy/host/verify-exposure.sh#L99)

- The founder's step list, from the console.
  [`DEPLOY.md:2325`](../../DEPLOY.md#L2325)

**Tests and CI**

- The real templates rendered by a TypeScript port of the renderer.
  [`host-hardening.test.ts:224`](../../test/host-hardening.test.ts#L224)

- Every host change goes through `run` or an APPLY-checking helper.
  [`host-hardening.test.ts:255`](../../test/host-hardening.test.ts#L255)

- ShellCheck is the scripts' static gate in the quality job.
  [`pipeline.yml:89`](../../.github/workflows/pipeline.yml#L89)
