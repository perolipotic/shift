import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Story 20.4: the scripts and units that close the host to everything but the
 * web (`deploy/host/`). DEPLOY.md §9.8 is their runbook.
 *
 * These are structural assertions over the real files. Nothing here runs a
 * script: the scripts change a host's firewall, sshd, swap, apt and Coolify,
 * and must only ever run on the host they are meant for, from its console,
 * with the founder's go. What is asserted instead: the exact firewall rules,
 * per family and in order; that every change in the script goes through its
 * dry-run wrapper; that the revert is armed before anything changes; the unit's
 * ordering; the drop-ins' sort order and values; and that no file names a
 * real address. ShellCheck runs over the scripts in CI's quality job.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const hostRoot = join(repoRoot, 'deploy', 'host');
const read = (path: string) => readFileSync(join(hostRoot, path), 'utf8');

const script = read('shift-host.sh');
const verify = read('verify-exposure.sh');

/** The body of one shell function, from `name() {` to its closing `}`. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`\n${name}() {`);
  expect(start, `${name}() is defined`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end);
}

/** The `-A` rules of a restore template, per chain, comments dropped. */
function chainsOf(template: string): Map<string, string[]> {
  const chains = new Map<string, string[]>();
  for (const line of template.split('\n')) {
    const match = /^-A (\S+) (.*)$/.exec(line);
    if (match === null) continue;
    const [, chain, rule] = match as unknown as [string, string, string];
    chains.set(chain, [...(chains.get(chain) ?? []), rule]);
  }
  return chains;
}

const SSH_FROM_TAILNET = '-i @TAILSCALE_IF@ -p tcp --dport @SSH_PORT@ -j RETURN';
const SSH_DROP = '-p tcp --dport @SSH_PORT@ -j DROP';
const PUBLIC_ONLY = '! -i @PUBLIC_IF@ -j RETURN';
const ESTABLISHED = '-m conntrack --ctstate RELATED,ESTABLISHED -j RETURN';
const WEB_PORTS = [
  '-p tcp -m conntrack --ctorigdstport 80 --ctdir ORIGINAL -j RETURN',
  '-p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j RETURN',
  '-p udp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j RETURN',
];

const EXPECTED: Record<'4' | '6', Record<'SHIFT-INPUT' | 'SHIFT-DOCKER-USER', string[]>> = {
  '4': {
    'SHIFT-INPUT': [
      ESTABLISHED,
      '-i lo -j RETURN',
      SSH_FROM_TAILNET,
      '-i @COOLIFY_BRIDGE@ -s @COOLIFY_SUBNET4@ -p tcp --dport @SSH_PORT@ -j RETURN',
      SSH_DROP,
      PUBLIC_ONLY,
      '-p icmp -j RETURN',
      '-p udp --sport 67 --dport 68 -j RETURN',
      '-p udp --dport @TAILSCALE_UDP_PORT@ -j RETURN',
      '-p tcp -m multiport --dports 80,443 -j RETURN',
      '-p udp --dport 443 -j RETURN',
      '-j DROP',
    ],
    'SHIFT-DOCKER-USER': [
      PUBLIC_ONLY,
      ESTABLISHED,
      '-m conntrack --ctorigdst 127.0.0.0/8 -j DROP',
      ...WEB_PORTS,
      '-j DROP',
    ],
  },
  '6': {
    'SHIFT-INPUT': [
      ESTABLISHED,
      '-i lo -j RETURN',
      '-p ipv6-icmp -j RETURN',
      SSH_FROM_TAILNET,
      '-i @COOLIFY_BRIDGE@ -s @COOLIFY_SUBNET6@ -p tcp --dport @SSH_PORT@ -j RETURN',
      SSH_DROP,
      PUBLIC_ONLY,
      '-p udp --sport 547 --dport 546 -j RETURN',
      '-p udp --dport @TAILSCALE_UDP_PORT@ -j RETURN',
      '-p tcp -m multiport --dports 80,443 -j RETURN',
      '-p udp --dport 443 -j RETURN',
      '-j DROP',
    ],
    'SHIFT-DOCKER-USER': [PUBLIC_ONLY, ESTABLISHED, '-m conntrack --ctorigdst ::1/128 -j DROP', ...WEB_PORTS, '-j DROP'],
  },
};

const PLACEHOLDERS = [
  '@PUBLIC_IF@',
  '@TAILSCALE_IF@',
  '@TAILSCALE_UDP_PORT@',
  '@SSH_PORT@',
  '@COOLIFY_BRIDGE@',
  '@COOLIFY_SUBNET4@',
  '@COOLIFY_SUBNET6@',
];

describe('the firewall rules (H-2, H-3, H-4)', () => {
  for (const family of ['4', '6'] as const) {
    const template = read(`firewall/shift-v${family}.rules`);
    const rules = template.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));

    it(`IPv${family}: writes only its own two chains, in one filter-table commit`, () => {
      expect(rules[0]).toBe('*filter');
      expect(rules.at(-1)).toBe('COMMIT');
      expect(rules.filter((line) => line === '*filter' || line === 'COMMIT')).toHaveLength(2);
      // No chain declaration, policy, flush, delete or insert: appends only,
      // into chains the script created and flushed. Docker's chains and the
      // rules already in DOCKER-USER (the dev-stack drop) are never written.
      for (const line of rules.slice(1, -1)) {
        expect(line, line).toMatch(/^-A SHIFT-(INPUT|DOCKER-USER) /);
      }
      expect([...chainsOf(template).keys()].sort()).toEqual(['SHIFT-DOCKER-USER', 'SHIFT-INPUT']);
    });

    it(`IPv${family}: the rules, exactly and in order`, () => {
      const chains = chainsOf(template);
      expect(chains.get('SHIFT-INPUT')).toEqual(EXPECTED[family]['SHIFT-INPUT']);
      expect(chains.get('SHIFT-DOCKER-USER')).toEqual(EXPECTED[family]['SHIFT-DOCKER-USER']);
    });

    it(`IPv${family}: admits with RETURN, never ACCEPT, and ends each chain with a drop`, () => {
      expect(template).not.toMatch(/-j ACCEPT/);
      for (const chain of chainsOf(template).values()) {
        expect(chain.at(-1)).toBe('-j DROP');
      }
    });

    it(`IPv${family}: judges published ports by the ORIGINAL destination port`, () => {
      // DOCKER-USER sees the packet after DNAT: --dport there is the
      // container's port, not the one the internet asked for.
      const dockerUser = chainsOf(template).get('SHIFT-DOCKER-USER') ?? [];
      expect(dockerUser.some((rule) => /--dport/.test(rule))).toBe(false);
      expect(dockerUser.filter((rule) => rule.includes('--ctorigdstport'))).toHaveLength(3);
    });

    it(`IPv${family}: SSH is admitted only from lo, the tailnet and Coolify's bridge`, () => {
      const input = chainsOf(template).get('SHIFT-INPUT') ?? [];
      const dropAt = input.indexOf(SSH_DROP);
      expect(dropAt).toBeGreaterThan(0);
      const before = input.slice(0, dropAt);
      // Every rule before the SSH drop is established traffic, loopback, ICMPv6
      // (neighbour discovery) or an SSH rule from the two admitted sources.
      for (const rule of before) {
        expect(
          [ESTABLISHED, '-i lo -j RETURN', '-p ipv6-icmp -j RETURN', SSH_FROM_TAILNET].includes(rule) ||
            rule.startsWith('-i @COOLIFY_BRIDGE@ -s @COOLIFY_SUBNET'),
          rule,
        ).toBe(true);
      }
      // After it, nothing names the SSH port, and the public interface sees
      // only the web, ICMP, DHCP and Tailscale's port before the final drop.
      expect(input.slice(dropAt + 1).some((rule) => rule.includes('@SSH_PORT@'))).toBe(false);
      expect(input[dropAt + 1]).toBe(PUBLIC_ONLY);
    });

    it(`IPv${family}: every placeholder is one the script replaces`, () => {
      const used = new Set(rules.join('\n').match(/@[A-Z0-9_]+@/g));
      // Six each: IPv4 names the Coolify IPv4 subnet, IPv6 the IPv6 one.
      expect(used.size).toBe(6);
      for (const name of used) {
        expect(PLACEHOLDERS, name).toContain(name);
      }
    });
  }


  it('the script replaces every placeholder, skips comments, and refuses one left over', () => {
    const render = functionBody(script, 'render_family');
    for (const name of PLACEHOLDERS) {
      expect(render, name).toContain(`line=\${line//${name}/`);
    }
    expect(render).toContain('[[ $line =~ ^[[:space:]]*(#|$) ]] && continue');
    expect(render).toContain('unreplaced placeholder');
    // Only the optional IPv6 Coolify subnet may drop its line when empty, and
    // the Coolify bridge's lines only at boot (render dies otherwise).
    expect(render).toContain('*@COOLIFY_SUBNET6@* && -z $COOLIFY_SUBNET6');
    expect(render).toContain('-z $COOLIFY_BRIDGE && $MODE != boot');
  });

  /**
   * render_family's rule, line for line: comments and blank lines dropped, the
   * IPv6 Coolify line dropped when that subnet is empty, each placeholder
   * replaced, and a leftover placeholder fatal. Run over the real templates
   * with sample values, so a template the script cannot render fails here.
   */
  function render(family: '4' | '6', values: Record<string, string>): string[] {
    const out: string[] = [];
    for (const raw of read(`firewall/shift-v${family}.rules`).split('\n')) {
      if (/^\s*(#|$)/.test(raw)) continue;
      if (raw.includes('@COOLIFY_SUBNET6@') && values['@COOLIFY_SUBNET6@'] === '') continue;
      let line = raw;
      for (const name of PLACEHOLDERS) line = line.split(name).join(values[name] ?? '');
      if (/@[A-Z0-9_]+@/.test(line)) throw new Error(`unreplaced placeholder: ${line}`);
      out.push(line);
    }
    return out;
  }
  const SAMPLE = {
    '@PUBLIC_IF@': 'pub0',
    '@TAILSCALE_IF@': 'ts0',
    '@TAILSCALE_UDP_PORT@': '41641',
    '@SSH_PORT@': '22',
    '@COOLIFY_BRIDGE@': 'br-sample',
    '@COOLIFY_SUBNET4@': '192.0.2.0/24',
    '@COOLIFY_SUBNET6@': '2001:db8::/64',
  };

  for (const family of ['4', '6'] as const) {
    it(`IPv${family}: the shipped template renders: *filter, appends, COMMIT, nothing else`, () => {
      const rendered = render(family, SAMPLE);
      expect(rendered[0]).toBe('*filter');
      expect(rendered.at(-1)).toBe('COMMIT');
      for (const line of rendered.slice(1, -1)) expect(line).toMatch(/^-A SHIFT-(INPUT|DOCKER-USER) /);
      expect(rendered.join('\n')).not.toContain('@');
      expect(rendered).toContain('-A SHIFT-DOCKER-USER ! -i pub0 -j RETURN');
    });
  }

  it('IPv6 without a Coolify IPv6 subnet renders without that one line', () => {
    const full = render('6', SAMPLE);
    const without = render('6', { ...SAMPLE, '@COOLIFY_SUBNET6@': '' });
    expect(full.length - without.length).toBe(1);
    expect(without.some((line) => line.includes('br-sample'))).toBe(false);
  });
});

describe('shift-host.sh', () => {
  it('is strict bash and plans by default', () => {
    expect(script.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(script).toMatch(/^export LC_ALL=C$/m);
    expect(script).toMatch(/^APPLY=0$/m);
    expect(script).toMatch(/^MODE=plan$/m);
    // A bare `apply` names what it changes, and each mode takes only its own arguments.
    expect(script).toContain('name what to apply: firewall sshd swap upgrades coolify, or all');
    expect(script).toContain('is a family for render, not a component');
    expect(script).toContain('components are for plan or apply, not for $MODE');
  });

  it('changes the host only through run or the helpers that check APPLY', () => {
    const helpers = ['run', 'put_file', 'append_line', 'state_write', 'state_copy', 'state_remove'];
    const helperLines = new Set<number>();
    const lines = script.split('\n');
    for (const name of helpers) {
      const start = lines.indexOf(`${name}() {`);
      expect(start, `${name}() is defined`).toBeGreaterThan(-1);
      for (let index = start; index < lines.length && lines[index] !== '}'; index += 1) helperLines.add(index);
      // Each helper checks APPLY itself, or acts only through run.
      expect(functionBody(script, name), name).toMatch(/\$APPLY -eq 1|\n\s+run /);
    }
    const mutating = [
      /"\$ipt" -w -[NFXIDA] /,
      /"\$ipt-restore"/,
      /\bsystemctl (enable|disable|stop|start|daemon-reload|try-reload-or-restart|reset-failed)\b/,
      /\bfallocate\b/,
      /\bmkswap\b/,
      /\bswapon -- /,
      /\bchmod\b/,
      /\bsysctl -p\b/,
      /\bapt-get\b/,
      /\binstall -/,
      /\brm -/,
      /\bmkdir\b/,
      /\bcp -/,
      /\bsed -i\b/,
      /\bsystemd-run\b/,
      /update instance_settings/,
      // Any redirection into a file (not /dev/null, not &2).
      /[^<]>>?\s*"?\$?[A-Za-z/{]/,
    ];
    lines.forEach((line, index) => {
      if (helperLines.has(index)) return;
      const code = line.trim();
      if (/^(#|say |drift |die |warn |ok |printf ' {4}would)/.test(code)) return;
      // Not redirections: to /dev/null or stderr, and comparisons in (( )).
      const bare = code.replace(/\(\(.*?\)\)/g, '').replace(/>\s*\/dev\/null|>&2|2>\/dev\/null|2>&1/g, '');
      if (!mutating.some((pattern) => pattern.test(bare))) return;
      // A continuation line belongs to the command above it.
      let start = index;
      while (start > 0 && (lines[start - 1] ?? '').trimEnd().endsWith('\\')) start -= 1;
      const command = (lines[start] ?? '').trim();
      expect(/^(if ! )?run /.test(command), `line ${index + 1}: ${code}`).toBe(true);
    });
  });

  it('records, then arms both ways back, BEFORE the guarded components run', () => {
    const main = functionBody(script, 'main');
    expect(main.indexOf('prepare_guarded_apply')).toBeGreaterThan(-1);
    expect(main.indexOf('"component_$c"')).toBeGreaterThan(main.indexOf('prepare_guarded_apply'));
    const prepare = functionBody(script, 'prepare_guarded_apply');
    const order = ['install_self', 'stage_firewall', 'record_sshd_dropin', 'systemctl enable "$BOOT_REVERT_UNIT"', 'systemd-run'];
    const at = order.map((step) => prepare.indexOf(step));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(prepare).toContain('run systemctl reset-failed "$REVERT_UNIT.timer" "$REVERT_UNIT.service"');
    expect(prepare).toContain('systemd-run --unit="$REVERT_UNIT" --collect');
    expect(prepare).toContain('--on-active="${REVERT_AFTER}s"');
    expect(prepare).toContain('"$INSTALLED_BIN" revert --from-timer');
    expect(script).toMatch(/^ {2}REVERT_AFTER=300$/m);
  });

  it('refuses an SSH session (sshd among the ancestors too) and a second pending change', () => {
    const main = functionBody(script, 'main');
    expect(main).toContain('in_ssh_session && [[ $ALLOW_SSH_SESSION -eq 0 ]]');
    expect(main).toContain('an unconfirmed change is pending');
    const session = functionBody(script, 'in_ssh_session');
    expect(session).toContain('SSH_CONNECTION');
    expect(session).toContain('/proc/$pid/stat');
    expect(session).toContain('[[ $comm == sshd* ]]');
  });

  it('enables the boot unit only on confirm, or when a revert restores a confirmed firewall', () => {
    const enables = script.split('\n').filter((line) => /systemctl enable "\$UNIT_NAME"/.test(line));
    expect(enables).toHaveLength(2);
    expect(functionBody(script, 'do_confirm')).toContain('run systemctl enable "$UNIT_NAME"');
    expect(functionBody(script, 'do_revert')).toContain('run systemctl enable "$UNIT_NAME"');
    expect(functionBody(script, 'prepare_guarded_apply')).toContain('run systemctl disable "$UNIT_NAME"');
  });

  it('confirm checks what is in force, then promotes the staged rules and env', () => {
    const confirm = functionBody(script, 'do_confirm');
    expect(confirm).toContain('nothing to confirm');
    expect(confirm).toContain('firewall_in_force ||');
    expect(confirm).toContain('sshd_hardened ||');
    expect(confirm).toContain('"$STAGE_DIR/firewall/shift-v4.rules" "$SHARE_DIR/firewall/shift-v4.rules"');
    expect(confirm).toContain('"$STAGE_DIR/host.env" "$CONF_DIR/host.env"');
    expect(confirm.indexOf('firewall_in_force')).toBeLessThan(confirm.indexOf('systemctl enable'));
  });

  it('reverts to the last confirmed state, only for what was pending, and runs to the end', () => {
    const revert = functionBody(script, 'do_revert');
    expect(revert).toContain('set +e');
    expect(revert).toContain('pending_has firewall');
    expect(revert).toContain('pending_has sshd');
    expect(revert).toContain('Restoring the last confirmed firewall.');
    expect(revert).toContain('SRC_DIR=$SHARE_DIR');
    expect(revert).toContain('unload_firewall');
    expect(revert).toContain('restore_sshd_dropin');
    const unload = functionBody(script, 'unload_firewall');
    expect(unload).toContain('remove_jumps "$fam" INPUT SHIFT-INPUT');
    expect(unload).toContain('remove_jumps "$fam" DOCKER-USER SHIFT-DOCKER-USER');
    expect(unload).toContain('run "$ipt" -w -X "$chain"');
    // Restoring a whole saved table would clobber what Docker changed since.
    expect(script).not.toMatch(/iptables-save|ip6tables-save/);
    const record = functionBody(script, 'record_sshd_dropin');
    expect(record).toContain('sshd-dropin.before');
    expect(record).toContain('sshd-dropin.absent');
  });

  it('is idempotent: one jump first (after Tailscale\'s), flushed chains, live rules checked', () => {
    const ensure = functionBody(script, 'ensure_first_jump');
    expect(ensure).toContain('jump_is_first "$fam" "$parent" "$target" && return 0');
    expect(ensure).toContain('run "$ipt" -w -D "$parent" -j "$target"');
    expect(ensure).toContain('run "$ipt" -w -I "$parent" 1 -j "$target"');
    expect(functionBody(script, 'jump_is_first')).toContain("grep -v -- ' -j ts-'");
    const load = functionBody(script, 'load_firewall');
    expect(load).toContain('run "$ipt" -w -F "$chain"');
    expect(load).toContain('rules=$(render_family "$fam")');
    expect(load).toContain('run "$ipt-restore" -w --noflush <<<"$rules"');
    expect(functionBody(script, 'firewall_in_force')).toContain('"$ipt" -w -C "$chain" "${args[@]}"');
    const swap = functionBody(script, 'component_swap');
    expect(swap).toContain('swapon --show=NAME --noheadings');
    expect(swap).toContain('$1 == f && $3 == "swap"');
    expect(swap).toContain('is not a swap area: refusing to overwrite it');
    expect(swap).toContain('smaller than ${SWAP_SIZE_MIB} MiB');
  });

  it('refuses where applying would cut Coolify or the operator off, or filter nothing', () => {
    expect(functionBody(script, 'component_firewall')).toContain('refusing, SSH from Coolify would be cut');
    expect(functionBody(script, 'load_firewall')).toContain('IPv4 has no DOCKER-USER chain');
    const interfaces = functionBody(script, 'check_interfaces');
    expect(interfaces).toContain('does not carry the IPv4 default route');
    expect(interfaces).toContain("TAILSCALE_IF '$TAILSCALE_IF' does not exist");
    expect(interfaces).toContain('is NOT filtered by these rules');
    const sshd = functionBody(script, 'component_sshd');
    expect(sshd).toContain('/root/.ssh/authorized_keys');
    expect(sshd).toContain('refusing to turn passwords off');
    expect(sshd).toContain('if ! sshd -t; then');
    expect(sshd).toContain('the drop-in was taken back');
    expect(functionBody(script, 'sshd_privsep_dir')).toContain('/run/sshd');
  });

  it('warns below Docker Engine 28 (loopback ports reachable from the LAN)', () => {
    expect(script).toMatch(/^readonly MIN_DOCKER_MAJOR=28$/m);
    expect(functionBody(script, 'component_firewall')).toContain('((major < MIN_DOCKER_MAJOR))');
  });

  it('turns Coolify auto-update off in its database and its own .env, and refuses an empty table', () => {
    const coolify = functionBody(script, 'component_coolify');
    expect(coolify).toContain('update instance_settings set is_auto_update_enabled = false');
    expect(coolify).toContain('AUTOUPDATE=false');
    expect(coolify).toContain("instance_settings is empty");
  });

  it('reads its env file as KEY=VALUE data, never sources it, and validates every value', () => {
    expect(script).not.toMatch(/^\s*(source|\.) /m);
    const example = read('host.env.example');
    for (const [, key, value] of example.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) {
      expect(script, `${key}'s default in load_config equals the example`).toContain(`\n  ${key}=${value}\n`);
      expect(functionBody(script, 'load_config'), `${key} is a known key`).toContain(key);
    }
    const validate = functionBody(script, 'validate_config');
    expect(validate).toContain('is_iface "$PUBLIC_IF"');
    expect(validate).toContain('pin COOLIFY_BRIDGE and COOLIFY_SUBNET4 together');
  });

  it('installs every source the installed copy needs', () => {
    const listed = /readonly SOURCES=\(([^)]*)\)/.exec(script)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    const files = (dir: string): string[] =>
      readdirSync(join(hostRoot, dir)).map((entry) => `${dir}/${entry}`);
    const shipped = ['firewall', 'sshd', 'sysctl', 'apt', 'systemd'].flatMap(files).sort();
    expect([...listed].sort()).toEqual(shipped);
  });
});

describe('the units', () => {
  const unitValues = (unit: string, key: string) =>
    [...unit.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))].flatMap((match) => (match[1] ?? '').split(/\s+/));
  const unit = read('systemd/shift-host-firewall.service');
  const atBoot = read('systemd/shift-host-revert-at-boot.service');

  it('the firewall unit re-applies the rules after Docker starts, and again when Docker restarts', () => {
    expect(unitValues(unit, 'After')).toEqual(expect.arrayContaining(['docker.service', 'tailscaled.service']));
    expect(unitValues(unit, 'PartOf')).toEqual(['docker.service']);
    expect(unitValues(unit, 'Type')).toEqual(['oneshot']);
    expect(unitValues(unit, 'RemainAfterExit')).toEqual(['yes']);
    expect(unitValues(unit, 'WantedBy')).toEqual(['multi-user.target', 'docker.service']);
    expect(unit).toMatch(/^ExecStart=\/usr\/local\/sbin\/shift-host boot$/m);
    expect(script).toMatch(/^readonly INSTALLED_BIN=\/usr\/local\/sbin\/shift-host$/m);
    expect(script).toMatch(/^readonly UNIT_NAME=shift-host-firewall\.service$/m);
  });

  it('the revert-at-boot unit runs only while a change is pending', () => {
    expect(unitValues(atBoot, 'ConditionPathExists')).toEqual(['/var/lib/shift-host/pending']);
    expect(script).toMatch(/^readonly STATE_DIR=\/var\/lib\/shift-host$/m);
    expect(atBoot).toMatch(/^ExecStart=\/usr\/local\/sbin\/shift-host revert --at-boot$/m);
    expect(unitValues(atBoot, 'After')).toEqual(expect.arrayContaining(['docker.service']));
    expect(script).toMatch(/^readonly BOOT_REVERT_UNIT=shift-host-revert-at-boot\.service$/m);
    expect(functionBody(script, 'clear_pending')).toContain('run systemctl disable "$BOOT_REVERT_UNIT"');
  });
});

describe('the drop-ins', () => {
  it('sshd: read before cloud-init and the cloud image, key-only, root by key only', () => {
    const [name] = readdirSync(join(hostRoot, 'sshd'));
    expect(name).toBe('00-shift-hardening.conf');
    const sorted = [name, '50-cloud-init.conf', '60-cloudimg-settings.conf'].sort();
    expect(sorted[0]).toBe(name);
    expect(script).toContain(`readonly SSHD_DROPIN=/etc/ssh/sshd_config.d/${name}`);
    const settings = Object.fromEntries(
      read(`sshd/${name}`)
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.startsWith('#'))
        .map((line) => line.trim().split(/\s+/) as [string, string])
        .map(([key, value]) => [key.toLowerCase(), value]),
    );
    expect(settings).toEqual({
      passwordauthentication: 'no',
      kbdinteractiveauthentication: 'no',
      permitemptypasswords: 'no',
      pubkeyauthentication: 'yes',
      permitrootlogin: 'prohibit-password',
    });
  });

  it('apt: read after the stock files, upgrades on, reboot off, Docker held', () => {
    const [name] = readdirSync(join(hostRoot, 'apt'));
    expect(name).toBe('52shift-unattended-upgrades');
    expect([name, '20auto-upgrades', '50unattended-upgrades'].sort().at(-1)).toBe(name);
    expect(script).toContain(`readonly APT_DROPIN=/etc/apt/apt.conf.d/${name}`);
    const apt = read(`apt/${name}`);
    expect(apt).toContain('APT::Periodic::Update-Package-Lists "1";');
    expect(apt).toContain('APT::Periodic::Unattended-Upgrade "1";');
    expect(apt).toContain('Unattended-Upgrade::Automatic-Reboot "false";');
    const blacklist = /Package-Blacklist \{([^}]*)\};/.exec(apt)?.[1] ?? '';
    for (const pkg of ['docker-ce', 'docker.io', 'containerd.io', 'containerd']) {
      expect(blacklist, pkg).toContain(`"${pkg}";`);
    }
  });

  it('sysctl: swappiness 10, the value the script holds fixed; 4 GiB of swap', () => {
    expect(read('sysctl/99-shift-swap.conf')).toMatch(/^vm\.swappiness = 10$/m);
    expect(script).toMatch(/^readonly SWAPPINESS=10$/m);
    expect(script).toMatch(/^ {2}SWAP_SIZE_MIB=4096$/m);
  });
});

describe('verify-exposure.sh', () => {
  it('scans every TCP port and the common UDP ports of both families, expecting only the web', () => {
    expect(verify).toMatch(/^set -euo pipefail$/m);
    expect(verify).toContain('-p 1-65535');
    expect(verify).toContain('-sU -p "$UDP_PORTS"');
    expect(verify).toContain('scan "IPv4 $IPV4" -4 "$IPV4"');
    expect(verify).toContain('scan "IPv6 $IPV6" -6 "$IPV6"');
    expect(verify).toContain('[[ $ports == "80,443" ]]');
    expect(verify).toContain('v6host="[$IPV6]"');
    expect(verify).toContain('http3 "IPv6 $IPV6" "https://$v6host/"');
    // No route for IPv6 is a failure, not a skip; a scan is bounded.
    expect(verify).toContain('--ipv4 and --ipv6 are both required');
    expect(verify).toContain('--host-timeout');
    expect(functionBody(verify, 'scan')).toContain('fail "$label: the TCP scan did not run');
  });

  it('proves over the tailnet that SSH offers publickey only, and that key login works', () => {
    expect(verify).toContain('-o PreferredAuthentications=none');
    expect(verify).toContain('[[ $methods == publickey ]]');
    expect(verify).toContain('StrictHostKeyChecking=accept-new');
    expect(verify).toContain('ssh is missing');
  });
});

describe('public repository', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  const deployDoc = readFileSync(join(repoRoot, 'DEPLOY.md'), 'utf8');
  const texts: [string, string][] = [
    ...files(hostRoot).map((path): [string, string] => [relative(repoRoot, path), readFileSync(path, 'utf8')]),
    ['DEPLOY.md §9.8', deployDoc.slice(deployDoc.indexOf('### 9.8 '))],
    [
      'the 20.4 spec',
      readFileSync(
        join(repoRoot, '_bmad-output/implementation-artifacts/spec-20-4-the-host-is-closed-to-everything-but-the-web.md'),
        'utf8',
      ),
    ],
  ];

  it('deploy/host, DEPLOY §9.8 and the spec name no real address or tailnet', () => {
    expect(texts[texts.length - 2]?.[1]).toContain('### 9.8 ');
    for (const [where, text] of texts) {
      for (const [address] of text.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)) {
        // Loopback and the wildcard only (the drop rule, and prose about them).
        expect(address.startsWith('127.') || address === '0.0.0.0', `${where}: ${address}`).toBe(true);
      }
      for (const [address] of text.matchAll(/\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/gi)) {
        expect.fail(`${where}: IPv6 literal ${address}`);
      }
      expect(text, where).not.toMatch(/\.ts\.net\b/);
    }
  });

  it('CI runs ShellCheck over the scripts', () => {
    const pipeline = parse(readFileSync(join(repoRoot, '.github', 'workflows', 'pipeline.yml'), 'utf8')) as {
      jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
    };
    const step = pipeline.jobs['quality']?.steps.find((candidate) => candidate.name === 'ShellCheck');
    expect(step?.run).toContain('shellcheck');
    expect(step?.run).toContain('deploy/host/*.sh');
  });
});
