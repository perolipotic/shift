#!/usr/bin/env bash
# Story 20.4: close the host to everything but the web (H-2, H-3, H-4, H-10,
# H-15). DEPLOY.md §9.8 is the runbook; read it before running anything here.
#
#   shift-host.sh [plan] [component...]        read-only: what would change (the default)
#   shift-host.sh apply <component...|all>     change the host (root)
#   shift-host.sh confirm                      keep an applied firewall/sshd change
#   shift-host.sh revert                       undo an unconfirmed firewall/sshd change
#   shift-host.sh status                       what is in force now
#   shift-host.sh render [4|6]                 print the rendered firewall rules
#   shift-host.sh boot                         load the confirmed firewall (the systemd unit)
#
# Components: firewall sshd swap upgrades coolify.
# Options: --env <file>  --revert-after <seconds>  --allow-ssh-session
#
# Safety:
# - `plan` is the default and changes nothing. Every change goes through `run`
#   or a state_* helper, which print instead of acting unless the mode changes
#   the host (`apply`, `confirm`, `revert`, `boot`).
# - Applying `firewall` or `sshd` first records what is there, then arms a
#   transient systemd timer that runs `revert` after REVERT_AFTER seconds
#   (default 300) unless `confirm` runs first, and enables a boot-time unit
#   that does the same revert if the host reboots before `confirm`.
# - `revert` puts back the last CONFIRMED state: the confirmed firewall if
#   there was one (else none), and the sshd drop-in exactly as it was.
# - Apply them from the VPS provider's console, not over SSH: a session with
#   sshd among its ancestors is refused unless --allow-ssh-session is given.
# - Only this script's own chains (SHIFT-INPUT, SHIFT-DOCKER-USER) and files
#   are written. Docker's and Tailscale's chains and the rules already in
#   DOCKER-USER are never edited.
# - Every run is idempotent: applying twice leaves one jump per chain, one
#   fstab line and one swapfile.
set -euo pipefail
umask 022
export LC_ALL=C

readonly SELF="${BASH_SOURCE[0]}"
SELF_DIR="$(cd -- "$(dirname -- "$SELF")" && pwd)"
readonly SELF_DIR
readonly INSTALLED_BIN=/usr/local/sbin/shift-host
readonly SHARE_DIR=/usr/local/share/shift-host
readonly CONF_DIR=/etc/shift-host
readonly STATE_DIR=/var/lib/shift-host
readonly STAGE_DIR=/var/lib/shift-host/staged
readonly UNIT_NAME=shift-host-firewall.service
readonly BOOT_REVERT_UNIT=shift-host-revert-at-boot.service
readonly REVERT_UNIT=shift-host-revert
readonly SSHD_DROPIN=/etc/ssh/sshd_config.d/00-shift-hardening.conf
readonly SYSCTL_DROPIN=/etc/sysctl.d/99-shift-swap.conf
readonly APT_DROPIN=/etc/apt/apt.conf.d/52shift-unattended-upgrades
readonly SWAPPINESS=10
readonly MIN_DOCKER_MAJOR=28
readonly ALL_COMPONENTS=(firewall sshd swap upgrades coolify)
readonly SOURCES=(
  firewall/shift-v4.rules firewall/shift-v6.rules
  sshd/00-shift-hardening.conf sysctl/99-shift-swap.conf apt/52shift-unattended-upgrades
  systemd/shift-host-firewall.service systemd/shift-host-revert-at-boot.service
)

APPLY=0
DRIFT=0
MODE=plan
ENV_FILE=""
ALLOW_SSH_SESSION=0
FROM_TIMER=0
REVERT_AFTER_ARG=""
SRC_DIR=""
COMPONENTS=()
RENDER_FAMILIES=()

say() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
ok() { say "  ok: $*"; }
drift() {
  DRIFT=1
  say "  change: $*"
}

# ------------------------------------------------- the only ways to change ----

# Every command that changes the host goes through here. Outside a changing
# mode it only prints the command.
run() {
  if [[ $APPLY -eq 1 ]]; then
    "$@"
  else
    printf '    would run:'
    printf ' %q' "$@"
    printf '\n'
  fi
}

# Installs a file unless the target already has the same content.
put_file() {
  local src=$1 dest=$2 mode=$3
  [[ -f $src ]] || die "missing source $src"
  if [[ -f $dest ]] && cmp -s -- "$src" "$dest"; then
    return 0
  fi
  run install -D -o root -g root -m "$mode" -- "$src" "$dest"
}

# Appends one line to a file, on a line of its own.
append_line() {
  local line=$1 file=$2
  if [[ $APPLY -eq 1 ]]; then
    if [[ -s $file && $(tail -c1 -- "$file" | od -An -c | tr -d ' ') != '\n' ]]; then
      printf '\n' >>"$file"
    fi
    printf '%s\n' "$line" >>"$file"
  else
    printf '    would append to %s: %s\n' "$file" "$line"
  fi
}

# The script's own bookkeeping under STATE_DIR.
state_write() {
  local file=$1 content=$2
  if [[ $APPLY -eq 1 ]]; then
    mkdir -p -- "$(dirname -- "$file")"
    printf '%s' "$content" >"$file"
  fi
}
state_copy() {
  local src=$1 dest=$2
  if [[ $APPLY -eq 1 ]]; then
    mkdir -p -- "$(dirname -- "$dest")"
    cp -p -- "$src" "$dest"
  fi
}
state_remove() {
  if [[ $APPLY -eq 1 ]]; then
    rm -rf -- "$@"
  fi
}

require_root() {
  [[ $(id -u) -eq 0 ]] || die "run as root (sudo $SELF $MODE ...)"
}

# ----------------------------------------------------------------- config ----

load_config() {
  local file=$1
  PUBLIC_IF=eth0
  TAILSCALE_IF=tailscale0
  TAILSCALE_UDP_PORT=41641
  SSH_PORT=22
  SSH_SERVICE=ssh.service
  COOLIFY_NETWORK=coolify
  COOLIFY_DB_CONTAINER=coolify-db
  COOLIFY_DB_USER=coolify
  COOLIFY_DB_NAME=coolify
  COOLIFY_SOURCE_ENV=/data/coolify/source/.env
  SWAPFILE=/swapfile
  SWAP_SIZE_MIB=4096
  REVERT_AFTER=300
  COOLIFY_BRIDGE=""
  COOLIFY_SUBNET4=""
  COOLIFY_SUBNET6=""

  if [[ -n $file && -f $file ]]; then
    # KEY=VALUE lines only, known keys only: the file is read, never sourced.
    local line key value
    while IFS= read -r line || [[ -n $line ]]; do
      [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
      [[ $line =~ ^([A-Z0-9_]+)=(.*)$ ]] || die "$file: not KEY=VALUE: $line"
      key=${BASH_REMATCH[1]}
      value=${BASH_REMATCH[2]}
      case $key in
        PUBLIC_IF | TAILSCALE_IF | TAILSCALE_UDP_PORT | SSH_PORT | SSH_SERVICE | \
          COOLIFY_NETWORK | COOLIFY_DB_CONTAINER | COOLIFY_DB_USER | COOLIFY_DB_NAME | \
          COOLIFY_SOURCE_ENV | SWAPFILE | SWAP_SIZE_MIB | REVERT_AFTER | \
          COOLIFY_BRIDGE | COOLIFY_SUBNET4 | COOLIFY_SUBNET6)
          printf -v "$key" '%s' "$value"
          ;;
        *) die "$file: unknown key $key" ;;
      esac
    done <"$file"
  fi
  if [[ -n $REVERT_AFTER_ARG ]]; then
    REVERT_AFTER=$REVERT_AFTER_ARG
  fi
  validate_config
}

is_iface() { [[ $1 =~ ^[A-Za-z0-9_.-]{1,15}$ ]]; }
is_port() { [[ $1 =~ ^[0-9]{1,5}$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
is_name() { [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; }
is_path() { [[ $1 =~ ^/[A-Za-z0-9_./-]+$ && $1 != */ ]]; }

validate_config() {
  is_iface "$PUBLIC_IF" || die "PUBLIC_IF is not an interface name: $PUBLIC_IF"
  is_iface "$TAILSCALE_IF" || die "TAILSCALE_IF is not an interface name: $TAILSCALE_IF"
  [[ $PUBLIC_IF != "$TAILSCALE_IF" ]] || die "PUBLIC_IF and TAILSCALE_IF are the same interface"
  is_port "$SSH_PORT" || die "SSH_PORT is not a port: $SSH_PORT"
  is_port "$TAILSCALE_UDP_PORT" || die "TAILSCALE_UDP_PORT is not a port: $TAILSCALE_UDP_PORT"
  [[ $SSH_SERVICE =~ ^[A-Za-z0-9@_.-]+\.service$ ]] || die "SSH_SERVICE is not a unit: $SSH_SERVICE"
  is_name "$COOLIFY_NETWORK" || die "COOLIFY_NETWORK is not a name: $COOLIFY_NETWORK"
  is_name "$COOLIFY_DB_CONTAINER" || die "COOLIFY_DB_CONTAINER is not a name: $COOLIFY_DB_CONTAINER"
  is_name "$COOLIFY_DB_USER" || die "COOLIFY_DB_USER is not a name: $COOLIFY_DB_USER"
  is_name "$COOLIFY_DB_NAME" || die "COOLIFY_DB_NAME is not a name: $COOLIFY_DB_NAME"
  is_path "$COOLIFY_SOURCE_ENV" || die "COOLIFY_SOURCE_ENV is not an absolute file path: $COOLIFY_SOURCE_ENV"
  is_path "$SWAPFILE" || die "SWAPFILE is not an absolute file path: $SWAPFILE"
  if ! [[ $SWAP_SIZE_MIB =~ ^[0-9]{3,6}$ ]] || ((10#$SWAP_SIZE_MIB < 512)); then
    die "SWAP_SIZE_MIB must be a number of MiB, at least 512"
  fi
  if ! [[ $REVERT_AFTER =~ ^[0-9]{2,4}$ ]] || ((10#$REVERT_AFTER < 60 || 10#$REVERT_AFTER > 3600)); then
    die "REVERT_AFTER must be 60-3600 seconds"
  fi
  # The Coolify bridge is pinned whole or read from Docker whole.
  if [[ -n $COOLIFY_BRIDGE || -n $COOLIFY_SUBNET4 || -n $COOLIFY_SUBNET6 ]]; then
    [[ -n $COOLIFY_BRIDGE && -n $COOLIFY_SUBNET4 ]] ||
      die "pin COOLIFY_BRIDGE and COOLIFY_SUBNET4 together (COOLIFY_SUBNET6 too if it has one), or none of them"
    is_iface "$COOLIFY_BRIDGE" || die "COOLIFY_BRIDGE is not an interface name: $COOLIFY_BRIDGE"
    [[ $COOLIFY_SUBNET4 =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]] ||
      die "COOLIFY_SUBNET4 is not an IPv4 CIDR: $COOLIFY_SUBNET4"
    if [[ -n $COOLIFY_SUBNET6 && ! $COOLIFY_SUBNET6 =~ ^[0-9A-Fa-f:]+/[0-9]{1,3}$ ]]; then
      die "COOLIFY_SUBNET6 is not an IPv6 CIDR: $COOLIFY_SUBNET6"
    fi
  fi
}

# Coolify reaches its own host over SSH from its Docker network, so SSH must
# be admitted from that network's bridge. Read it from Docker unless host.env
# pins it.
resolve_coolify() {
  if [[ -n $COOLIFY_BRIDGE ]]; then
    return 0
  fi
  local id name driver subnet
  driver=$(docker network inspect -f '{{.Driver}}' "$COOLIFY_NETWORK" 2>/dev/null) || return 1
  [[ $driver == bridge ]] || die "Docker network '$COOLIFY_NETWORK' is a '$driver' network, not a bridge"
  id=$(docker network inspect -f '{{.Id}}' "$COOLIFY_NETWORK")
  name=$(docker network inspect -f '{{index .Options "com.docker.network.bridge.name"}}' "$COOLIFY_NETWORK")
  [[ $name == "<no value>" ]] && name=""
  COOLIFY_BRIDGE=${name:-br-${id:0:12}}
  for subnet in $(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$COOLIFY_NETWORK"); do
    if [[ $subnet == *:* ]]; then
      if [[ -n $COOLIFY_SUBNET6 ]]; then
        warn "Coolify network has more than one IPv6 subnet; using $COOLIFY_SUBNET6"
      else
        COOLIFY_SUBNET6=$subnet
      fi
    elif [[ -n $COOLIFY_SUBNET4 ]]; then
      warn "Coolify network has more than one IPv4 subnet; using $COOLIFY_SUBNET4"
    else
      COOLIFY_SUBNET4=$subnet
    fi
  done
  if [[ -z $COOLIFY_SUBNET4 ]]; then
    COOLIFY_BRIDGE=""
    COOLIFY_SUBNET6=""
    return 1
  fi
  validate_config
}

# What `apply` resolved, kept for `boot` in case Docker cannot be asked.
load_recorded_coolify() {
  local file=$STATE_DIR/coolify.env line
  [[ -f $file ]] || return 1
  while IFS= read -r line; do
    case $line in
      COOLIFY_BRIDGE=*) COOLIFY_BRIDGE=${line#*=} ;;
      COOLIFY_SUBNET4=*) COOLIFY_SUBNET4=${line#*=} ;;
      COOLIFY_SUBNET6=*) COOLIFY_SUBNET6=${line#*=} ;;
    esac
  done <"$file"
  [[ -n $COOLIFY_BRIDGE && -n $COOLIFY_SUBNET4 ]] || return 1
  validate_config
}

# A wrong interface name would make every rule RETURN: fail loudly instead.
check_interfaces() {
  ip link show dev "$PUBLIC_IF" >/dev/null 2>&1 || die "PUBLIC_IF '$PUBLIC_IF' does not exist on this host"
  ip -4 route show default | grep -qw "dev $PUBLIC_IF" ||
    die "PUBLIC_IF '$PUBLIC_IF' does not carry the IPv4 default route ($(ip -4 route show default | head -n1))"
  local v6
  v6=$(ip -6 route show default 2>/dev/null | head -n1)
  if [[ -n $v6 && $v6 != *"dev $PUBLIC_IF"* ]]; then
    warn "the IPv6 default route is not on $PUBLIC_IF: $v6"
  fi
  ip link show dev "$TAILSCALE_IF" >/dev/null 2>&1 || die "TAILSCALE_IF '$TAILSCALE_IF' does not exist (is Tailscale up?)"
  ip link show dev "$COOLIFY_BRIDGE" >/dev/null 2>&1 || die "the Coolify bridge '$COOLIFY_BRIDGE' does not exist"
  # These rules filter only PUBLIC_IF (and SSH everywhere). Say so for any
  # other interface with a global address, such as a provider's private network.
  local name
  while read -r name _ addresses; do
    name=${name%%@*}
    case $name in
      lo | "$PUBLIC_IF" | "$TAILSCALE_IF" | docker0 | br-* | veth*) continue ;;
    esac
    if [[ -n ${addresses:-} ]]; then
      warn "interface $name has an address and is NOT filtered by these rules (only SSH is): $addresses"
    fi
  done < <(ip -br addr show scope global)
}

# An SSH session: the variables, or sshd among this process's ancestors (sudo
# resets the variables; tmux and screen detach from the ancestry, so this is a
# safety net, not a guarantee: use the console).
in_ssh_session() {
  [[ -n ${SSH_CONNECTION:-} || -n ${SSH_TTY:-} ]] && return 0
  local pid=$$ stat comm
  while [[ $pid -gt 1 && -r /proc/$pid/stat ]]; do
    stat=$(</proc/"$pid"/stat)
    comm=${stat#*(}
    comm=${comm%)*}
    [[ $comm == sshd* ]] && return 0
    stat=${stat##*) }
    read -r _ pid _ <<<"$stat"
  done
  return 1
}

# --------------------------------------------------------------- firewall ----

ipt_of() { if [[ $1 == 4 ]]; then printf iptables; else printf ip6tables; fi; }

# Prints the rules for one family with every @NAME@ replaced: `*filter`, the
# `-A` lines and `COMMIT`, comments dropped. A line naming @COOLIFY_SUBNET6@
# is dropped when Coolify has no IPv6 subnet, and (at boot only) the Coolify
# SSH lines when the bridge is unknown. Any other placeholder left over is an
# error, so an empty value never widens a rule.
render_family() {
  local fam=$1 template line
  template="$SRC_DIR/firewall/shift-v$fam.rules"
  [[ -f $template ]] || die "missing template $template"
  if [[ -z $COOLIFY_BRIDGE && $MODE != boot ]]; then
    die "the Coolify bridge is not resolved"
  fi
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ $line == *@COOLIFY_SUBNET6@* && -z $COOLIFY_SUBNET6 ]]; then
      continue
    fi
    if [[ $line == *@COOLIFY_BRIDGE@* && -z $COOLIFY_BRIDGE ]]; then
      continue
    fi
    line=${line//@PUBLIC_IF@/$PUBLIC_IF}
    line=${line//@TAILSCALE_IF@/$TAILSCALE_IF}
    line=${line//@TAILSCALE_UDP_PORT@/$TAILSCALE_UDP_PORT}
    line=${line//@SSH_PORT@/$SSH_PORT}
    line=${line//@COOLIFY_BRIDGE@/$COOLIFY_BRIDGE}
    line=${line//@COOLIFY_SUBNET4@/$COOLIFY_SUBNET4}
    line=${line//@COOLIFY_SUBNET6@/$COOLIFY_SUBNET6}
    if [[ $line =~ @[A-Z0-9_]+@ ]]; then
      die "unreplaced placeholder in $template: $line"
    fi
    printf '%s\n' "$line"
  done <"$template"
}

chain_exists() { "$(ipt_of "$1")" -w -S "$2" >/dev/null 2>&1; }

jump_count() {
  local fam=$1 parent=$2 target=$3
  "$(ipt_of "$fam")" -w -S "$parent" 2>/dev/null | grep -cxF -- "-A $parent -j $target" || true
}

# First, ignoring Tailscale's own ts-* jumps, which tailscaled puts at the top
# when it (re)starts and which only admit tailnet traffic and its UDP port.
jump_is_first() {
  local fam=$1 parent=$2 target=$3 first
  first=$("$(ipt_of "$fam")" -w -S "$parent" 2>/dev/null | grep -- '^-A ' | grep -v -- ' -j ts-' | head -n1 || true)
  [[ $first == "-A $parent -j $target" && $(jump_count "$fam" "$parent" "$target") -eq 1 ]]
}

# Exactly one jump, at position 1.
ensure_first_jump() {
  local fam=$1 parent=$2 target=$3 ipt count i
  ipt=$(ipt_of "$fam")
  jump_is_first "$fam" "$parent" "$target" && return 0
  count=$(jump_count "$fam" "$parent" "$target")
  for ((i = 0; i < count; i++)); do
    run "$ipt" -w -D "$parent" -j "$target"
  done
  run "$ipt" -w -I "$parent" 1 -j "$target"
}

remove_jumps() {
  local fam=$1 parent=$2 target=$3 ipt count i
  ipt=$(ipt_of "$fam")
  count=$(jump_count "$fam" "$parent" "$target")
  for ((i = 0; i < count; i++)); do
    run "$ipt" -w -D "$parent" -j "$target"
  done
}

rule_count() {
  "$(ipt_of "$1")" -w -S "$2" 2>/dev/null | grep -c -- "^-A $2 " || true
}

# The live chains hold exactly the rendered rules: each one present (-C), and
# no more of them than rendered.
firewall_in_force() {
  local fam ipt chain want rule
  local -a args
  for fam in 4 6; do
    ipt=$(ipt_of "$fam")
    for chain in SHIFT-INPUT SHIFT-DOCKER-USER; do
      if [[ $chain == SHIFT-DOCKER-USER ]] && ! chain_exists "$fam" DOCKER-USER; then
        continue
      fi
      chain_exists "$fam" "$chain" || return 1
      want=0
      while IFS= read -r rule; do
        [[ $rule == "-A $chain "* ]] || continue
        want=$((want + 1))
        read -ra args <<<"${rule#-A "$chain" }"
        "$ipt" -w -C "$chain" "${args[@]}" 2>/dev/null || return 1
      done < <(render_family "$fam")
      [[ $(rule_count "$fam" "$chain") -eq $want ]] || return 1
    done
    jump_is_first "$fam" INPUT SHIFT-INPUT || return 1
    if chain_exists "$fam" DOCKER-USER; then
      jump_is_first "$fam" DOCKER-USER SHIFT-DOCKER-USER || return 1
    fi
  done
}

# Creates (if missing) and flushes our two chains, loads the rendered appends
# in one restore, and puts the jumps first. Flush-then-load leaves the chains
# empty for an instant: open, never closed. IPv4 needs Docker's DOCKER-USER
# (strict); IPv6 without it (Docker's ip6tables off) is filtered on INPUT,
# where Docker's userland proxy delivers it.
load_firewall() {
  local strict=$1 fam ipt chain
  if ! chain_exists 4 DOCKER-USER; then
    [[ $strict -eq 1 ]] && die "IPv4 has no DOCKER-USER chain (is Docker running, on its iptables backend?)"
    warn "IPv4 has no DOCKER-USER chain yet; published ports are not filtered for IPv4"
  fi
  if ! chain_exists 6 DOCKER-USER; then
    warn "IPv6 has no DOCKER-USER chain (Docker's ip6tables off?); IPv6 is filtered on INPUT only"
  fi
  for fam in 4 6; do
    ipt=$(ipt_of "$fam")
    for chain in SHIFT-INPUT SHIFT-DOCKER-USER; do
      if ! chain_exists "$fam" "$chain"; then
        run "$ipt" -w -N "$chain"
      fi
      run "$ipt" -w -F "$chain"
    done
    if [[ $APPLY -eq 1 ]]; then
      # Rendered first, so a render that fails stops here, before any restore.
      local rules
      rules=$(render_family "$fam")
      run "$ipt-restore" -w --noflush <<<"$rules" ||
        die "$ipt-restore refused the rendered rules; the SHIFT-* chains are empty (open), nothing is closed"
    else
      run "$ipt-restore" -w --noflush "<the rules '$SELF render $fam' prints>"
    fi
    ensure_first_jump "$fam" INPUT SHIFT-INPUT
    if chain_exists "$fam" DOCKER-USER; then
      ensure_first_jump "$fam" DOCKER-USER SHIFT-DOCKER-USER
    fi
  done
}

unload_firewall() {
  local fam ipt chain
  for fam in 4 6; do
    ipt=$(ipt_of "$fam")
    remove_jumps "$fam" INPUT SHIFT-INPUT
    remove_jumps "$fam" DOCKER-USER SHIFT-DOCKER-USER
    for chain in SHIFT-INPUT SHIFT-DOCKER-USER; do
      if chain_exists "$fam" "$chain"; then
        run "$ipt" -w -F "$chain"
        run "$ipt" -w -X "$chain"
      fi
    done
  done
}

docker_major() {
  local version
  version=$(docker version --format '{{.Server.Version}}' 2>/dev/null) || return 1
  printf '%s\n' "${version%%.*}"
}

component_firewall() {
  say "firewall (H-2, H-3, H-4): only 80/443 public; SSH from $TAILSCALE_IF and Coolify's bridge"
  local major
  major=$(docker_major) || die "cannot ask Docker for its version (is it running?)"
  if ((major < MIN_DOCKER_MAJOR)); then
    warn "Docker Engine $major is older than $MIN_DOCKER_MAJOR: loopback-published ports are reachable from the LAN; SHIFT-DOCKER-USER drops them, upgrade in the maintenance window"
  fi
  resolve_coolify || die "Docker network '$COOLIFY_NETWORK' not found or has no IPv4 subnet: refusing, SSH from Coolify would be cut"
  check_interfaces
  say "  Coolify network $COOLIFY_NETWORK: bridge $COOLIFY_BRIDGE, $COOLIFY_SUBNET4${COOLIFY_SUBNET6:+, $COOLIFY_SUBNET6}"
  if firewall_in_force; then
    ok "SHIFT-INPUT and SHIFT-DOCKER-USER hold the rendered rules and are jumped to first (IPv4 and IPv6)"
  else
    drift "load SHIFT-INPUT and SHIFT-DOCKER-USER (review them: $SELF render)"
  fi
  if [[ $APPLY -eq 1 ]] || ! firewall_in_force; then
    load_firewall 1
    state_write "$STATE_DIR/coolify.env" \
      "$(printf 'COOLIFY_BRIDGE=%s\nCOOLIFY_SUBNET4=%s\nCOOLIFY_SUBNET6=%s' "$COOLIFY_BRIDGE" "$COOLIFY_SUBNET4" "$COOLIFY_SUBNET6")"
    if [[ $APPLY -eq 1 ]] && ! firewall_in_force; then
      die "the loaded rules do not match the rendered ones; the revert will undo them"
    fi
  fi
  if systemctl is-enabled --quiet "$UNIT_NAME" 2>/dev/null; then
    ok "$UNIT_NAME is enabled (re-applies the confirmed rules after Docker starts)"
  else
    drift "$UNIT_NAME is enabled by '$SELF confirm', after the change is confirmed"
  fi
}

# The installed copy runs the boot unit, the revert and later plans; the
# firewall templates and host.env are STAGED and become the confirmed ones
# only on `confirm`.
install_self() {
  local rel
  put_file "$SELF" "$INSTALLED_BIN" 0755
  for rel in "${SOURCES[@]}"; do
    case $rel in
      firewall/*) ;;
      *) put_file "$SRC_DIR/$rel" "$SHARE_DIR/$rel" 0644 ;;
    esac
  done
  put_file "$SRC_DIR/systemd/$UNIT_NAME" "/etc/systemd/system/$UNIT_NAME" 0644
  put_file "$SRC_DIR/systemd/$BOOT_REVERT_UNIT" "/etc/systemd/system/$BOOT_REVERT_UNIT" 0644
  run systemctl daemon-reload
}

stage_firewall() {
  state_remove "$STAGE_DIR"
  state_copy "$SRC_DIR/firewall/shift-v4.rules" "$STAGE_DIR/firewall/shift-v4.rules"
  state_copy "$SRC_DIR/firewall/shift-v6.rules" "$STAGE_DIR/firewall/shift-v6.rules"
  if [[ -n $ENV_FILE ]]; then
    state_copy "$ENV_FILE" "$STAGE_DIR/host.env"
  elif [[ -f $CONF_DIR/host.env ]]; then
    state_copy "$CONF_DIR/host.env" "$STAGE_DIR/host.env"
  fi
}

# ------------------------------------------------------------------- sshd ----

sshd_privsep_dir() {
  # Socket-activated sshd (Ubuntu 24.04 on) may not have created it yet, and
  # `sshd -t`/`-T` refuse without it.
  if [[ ! -d /run/sshd ]]; then
    run install -d -m 0755 /run/sshd
  fi
}

sshd_effective() { sshd -T 2>/dev/null | grep -E "^$1 " | cut -d' ' -f2- || true; }

sshd_hardened() {
  [[ $(sshd_effective passwordauthentication) == no ]] &&
    [[ $(sshd_effective kbdinteractiveauthentication) == no ]] &&
    [[ $(sshd_effective permitrootlogin) =~ ^(prohibit-password|without-password)$ ]]
}

component_sshd() {
  say "sshd (H-4): key-only, root by key only, read before cloud-init's drop-in"
  local src=$SRC_DIR/sshd/00-shift-hardening.conf
  # Coolify logs in as root by key, and so does the operator: no key, no apply.
  # A key line may start with options (from=, restrict, ...).
  if ! grep -Eq '(^|[[:space:],"])(ssh-(ed25519|rsa|dss)|ecdsa-sha2-[a-z0-9]+|sk-[a-z0-9@.-]+) [A-Za-z0-9+/=]{16,}' \
    /root/.ssh/authorized_keys 2>/dev/null; then
    die "/root/.ssh/authorized_keys holds no key: refusing to turn passwords off"
  fi
  local ours other
  ours=$(basename -- "$SSHD_DROPIN")
  while IFS= read -r other; do
    if [[ $other != "$ours" && $(printf '%s\n%s\n' "$other" "$ours" | sort | head -n1) == "$other" ]]; then
      warn "$other sorts before $ours and is read first: check it sets none of the hardened keywords"
    fi
  done < <(find /etc/ssh/sshd_config.d -maxdepth 1 -name '*.conf' -printf '%f\n' 2>/dev/null | sort)
  if [[ ! -d /run/sshd && $APPLY -eq 0 ]]; then
    say "  note: /run/sshd is missing, so sshd -T cannot answer until it exists"
  fi
  if [[ -f $SSHD_DROPIN ]] && cmp -s -- "$src" "$SSHD_DROPIN" && sshd_hardened; then
    ok "$SSHD_DROPIN in place; sshd -T: passwordauthentication no, permitrootlogin $(sshd_effective permitrootlogin)"
    return 0
  fi
  drift "install $SSHD_DROPIN and reload $SSH_SERVICE (now: passwordauthentication $(sshd_effective passwordauthentication), permitrootlogin $(sshd_effective permitrootlogin))"
  put_file "$src" "$SSHD_DROPIN" 0644
  sshd_privsep_dir
  if [[ $APPLY -eq 1 ]]; then
    if ! sshd -t; then
      restore_sshd_dropin
      die "sshd -t rejected the configuration; the drop-in was taken back"
    fi
  else
    say "    would check: sshd -t, then sshd -T"
  fi
  # With socket activation, a new connection reads the new configuration
  # anyway; the reload covers a running ssh.service.
  run systemctl try-reload-or-restart "$SSH_SERVICE"
  if [[ $APPLY -eq 1 ]] && ! sshd_hardened; then
    restore_sshd_dropin
    run systemctl try-reload-or-restart "$SSH_SERVICE"
    die "sshd -T does not show the hardened values (another file or a Match block wins?); the drop-in was taken back"
  fi
}

# What the drop-in was before `apply`: recorded first, whatever happens next.
record_sshd_dropin() {
  state_remove "$STATE_DIR/sshd-dropin.before" "$STATE_DIR/sshd-dropin.absent"
  if [[ -f $SSHD_DROPIN ]]; then
    state_copy "$SSHD_DROPIN" "$STATE_DIR/sshd-dropin.before"
  else
    state_write "$STATE_DIR/sshd-dropin.absent" ""
  fi
}

# Puts the drop-in back as recorded. With no record, leaves it alone.
restore_sshd_dropin() {
  if [[ -f $STATE_DIR/sshd-dropin.before ]]; then
    run install -o root -g root -m 0644 -- "$STATE_DIR/sshd-dropin.before" "$SSHD_DROPIN"
  elif [[ -f $STATE_DIR/sshd-dropin.absent && -f $SSHD_DROPIN ]]; then
    run rm -f -- "$SSHD_DROPIN"
  fi
}

# ------------------------------------------------------------------- swap ----

component_swap() {
  say "swap (H-15): ${SWAP_SIZE_MIB} MiB at $SWAPFILE, vm.swappiness=$SWAPPINESS"
  local src=$SRC_DIR/sysctl/99-shift-swap.conf
  grep -Eq "^vm\.swappiness[[:space:]]*=[[:space:]]*$SWAPPINESS\$" "$src" ||
    die "$src does not set vm.swappiness = $SWAPPINESS; keep the two in step"
  local other
  other=$(swapon --show=NAME --noheadings 2>/dev/null | grep -vxF -- "$SWAPFILE" || true)
  if [[ -n $other ]]; then
    warn "other swap is active as well: $(tr '\n' ' ' <<<"$other")"
  fi
  local want_bytes=$((SWAP_SIZE_MIB * 1024 * 1024))
  if swapon --show=NAME --noheadings 2>/dev/null | grep -qxF -- "$SWAPFILE"; then
    if (($(stat -c %s -- "$SWAPFILE") < want_bytes)); then
      drift "$SWAPFILE is active but smaller than ${SWAP_SIZE_MIB} MiB: swapoff, remove and re-run apply swap in the maintenance window"
    else
      ok "$SWAPFILE is active ($(($(stat -c %s -- "$SWAPFILE") / 1024 / 1024)) MiB)"
    fi
  else
    drift "create and enable $SWAPFILE"
    local fresh=0
    if [[ ! -e $SWAPFILE ]]; then
      local dir avail fstype
      dir=$(dirname -- "$SWAPFILE")
      [[ -d $dir ]] || die "$dir does not exist"
      fstype=$(findmnt -no FSTYPE --target "$dir")
      [[ $fstype != btrfs ]] || die "$dir is on btrfs: a swapfile there needs a no-CoW file; make it by hand"
      avail=$(df --output=avail -m -- "$dir" | tail -n1 | tr -d ' ')
      ((avail > SWAP_SIZE_MIB + 2048)) || die "only ${avail} MiB free beside $SWAPFILE"
      run fallocate -l "${SWAP_SIZE_MIB}MiB" -- "$SWAPFILE"
      run chmod 600 -- "$SWAPFILE"
      run mkswap -- "$SWAPFILE"
      fresh=1
    else
      [[ -f $SWAPFILE ]] || die "$SWAPFILE exists and is not a file"
      [[ $(blkid -p -s TYPE -o value -- "$SWAPFILE" 2>/dev/null || true) == swap ]] ||
        die "$SWAPFILE exists and is not a swap area: refusing to overwrite it"
      (($(stat -c %s -- "$SWAPFILE") >= want_bytes)) || die "$SWAPFILE exists and is smaller than ${SWAP_SIZE_MIB} MiB"
      run chmod 600 -- "$SWAPFILE"
    fi
    if ! run swapon -- "$SWAPFILE"; then
      if [[ $fresh -eq 1 ]]; then
        run rm -f -- "$SWAPFILE"
      fi
      die "swapon refused $SWAPFILE"
    fi
  fi
  if awk -v f="$SWAPFILE" '$1 == f && $3 == "swap" { found = 1 } END { exit !found }' /etc/fstab; then
    ok "/etc/fstab enables $SWAPFILE at boot"
  elif awk -v f="$SWAPFILE" '$1 == f { found = 1 } END { exit !found }' /etc/fstab; then
    die "/etc/fstab names $SWAPFILE but not as swap: fix it by hand"
  else
    drift "add $SWAPFILE to /etc/fstab"
    append_line "$SWAPFILE none swap sw 0 0" /etc/fstab
  fi
  if [[ -f $SYSCTL_DROPIN ]] && cmp -s -- "$src" "$SYSCTL_DROPIN" && [[ $(sysctl -n vm.swappiness) == "$SWAPPINESS" ]]; then
    ok "vm.swappiness = $SWAPPINESS ($SYSCTL_DROPIN)"
  else
    drift "set vm.swappiness = $SWAPPINESS (now $(sysctl -n vm.swappiness))"
    put_file "$src" "$SYSCTL_DROPIN" 0644
    run sysctl -p "$SYSCTL_DROPIN"
  fi
}

# --------------------------------------------------------------- upgrades ----

apt_value() { apt-config dump 2>/dev/null | grep -E "^$1 " | tail -n1 | cut -d' ' -f2- || true; }

apt_settled() {
  [[ $(apt_value 'Unattended-Upgrade::Automatic-Reboot') == '"false";' ]] &&
    [[ $(apt_value 'APT::Periodic::Unattended-Upgrade') == '"1";' ]] &&
    [[ $(apt_value 'APT::Periodic::Update-Package-Lists') == '"1";' ]]
}

component_upgrades() {
  say "upgrades (H-10): unattended security upgrades on, automatic reboot off, Docker held"
  if dpkg-query -W -f='${Status}' unattended-upgrades 2>/dev/null | grep -q 'install ok installed'; then
    ok "unattended-upgrades is installed"
  else
    drift "install unattended-upgrades"
    run env DEBIAN_FRONTEND=noninteractive apt-get update
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades
  fi
  local src=$SRC_DIR/apt/52shift-unattended-upgrades
  if [[ -f $APT_DROPIN ]] && cmp -s -- "$src" "$APT_DROPIN" && apt_settled; then
    ok "apt-config: Unattended-Upgrade \"1\", Automatic-Reboot \"false\", Docker and containerd blacklisted"
  else
    drift "install $APT_DROPIN (now: Unattended-Upgrade $(apt_value 'APT::Periodic::Unattended-Upgrade') Automatic-Reboot $(apt_value 'Unattended-Upgrade::Automatic-Reboot'))"
    put_file "$src" "$APT_DROPIN" 0644
    if [[ $APPLY -eq 1 ]] && ! apt_settled; then
      die "a later file in /etc/apt/apt.conf.d overrides $APT_DROPIN: $(grep -lE 'Automatic-Reboot|Periodic::Unattended-Upgrade' /etc/apt/apt.conf.d/* | tr '\n' ' ')"
    fi
  fi
  local timer
  for timer in apt-daily.timer apt-daily-upgrade.timer; do
    if systemctl is-enabled --quiet "$timer" 2>/dev/null; then
      ok "$timer is enabled"
    else
      drift "enable $timer"
      run systemctl enable --now "$timer"
    fi
  done
}

# ---------------------------------------------------------------- coolify ----

coolify_psql() {
  docker exec -i "$COOLIFY_DB_CONTAINER" psql -U "$COOLIFY_DB_USER" -d "$COOLIFY_DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"
}

component_coolify() {
  say "coolify (H-10): auto-update off; upgrade by hand in the maintenance window"
  local rows enabled
  rows=$(coolify_psql 'select count(*) from instance_settings') ||
    die "cannot read Coolify's settings from container $COOLIFY_DB_CONTAINER"
  [[ $rows -ge 1 ]] || die "Coolify's instance_settings is empty: finish Coolify's own setup first"
  enabled=$(coolify_psql 'select bool_or(is_auto_update_enabled) from instance_settings')
  if [[ $enabled == f ]]; then
    ok "is_auto_update_enabled is false"
  else
    drift "turn Coolify auto-update off (the same field as Settings > Auto Update in the UI)"
    run docker exec -i "$COOLIFY_DB_CONTAINER" psql -U "$COOLIFY_DB_USER" -d "$COOLIFY_DB_NAME" -v ON_ERROR_STOP=1 \
      -c 'update instance_settings set is_auto_update_enabled = false where is_auto_update_enabled'
  fi
  # Coolify's own .env: its init and its upgrade script read AUTOUPDATE, so the
  # setting survives a manual upgrade.
  [[ -f $COOLIFY_SOURCE_ENV ]] || die "no Coolify environment file at $COOLIFY_SOURCE_ENV"
  if grep -qx 'AUTOUPDATE=false' "$COOLIFY_SOURCE_ENV"; then
    ok "AUTOUPDATE=false in $COOLIFY_SOURCE_ENV"
  else
    drift "pin AUTOUPDATE=false in $COOLIFY_SOURCE_ENV"
    state_copy "$COOLIFY_SOURCE_ENV" "$STATE_DIR/coolify-source.env.before"
    if grep -q '^AUTOUPDATE=' "$COOLIFY_SOURCE_ENV"; then
      run sed -i 's/^AUTOUPDATE=.*/AUTOUPDATE=false/' "$COOLIFY_SOURCE_ENV"
    else
      append_line 'AUTOUPDATE=false' "$COOLIFY_SOURCE_ENV"
    fi
  fi
}

# ----------------------------------------------------- revert and confirm ----

revert_armed() { systemctl is-active --quiet "$REVERT_UNIT.timer" 2>/dev/null; }
pending_has() { [[ -f $STATE_DIR/pending ]] && grep -qx "$1" "$STATE_DIR/pending"; }

# Before anything changes: install the copy the revert runs, record what is
# there, and arm both ways back (the timer, and the boot-time unit).
prepare_guarded_apply() {
  install_self
  state_write "$STATE_DIR/pending" "$(printf '%s\n' "${GUARDED[@]}")"
  if pending_has firewall; then
    stage_firewall
    if systemctl is-enabled --quiet "$UNIT_NAME" 2>/dev/null; then
      state_write "$STATE_DIR/unit-was-enabled" "1"
      # An unconfirmed firewall never comes back at boot.
      run systemctl disable "$UNIT_NAME"
    else
      state_remove "$STATE_DIR/unit-was-enabled"
    fi
  fi
  if pending_has sshd; then
    record_sshd_dropin
  fi
  run systemctl enable "$BOOT_REVERT_UNIT"
  run systemctl reset-failed "$REVERT_UNIT.timer" "$REVERT_UNIT.service"
  run systemd-run --unit="$REVERT_UNIT" --collect \
    --description="Shift host: revert an unconfirmed firewall/sshd change" \
    --on-active="${REVERT_AFTER}s" --timer-property=AccuracySec=1s \
    "$INSTALLED_BIN" revert --from-timer
  say "A revert is armed: in ${REVERT_AFTER}s, or at the next boot, the change is undone unless confirmed."
}

confirm_hint() {
  say ""
  say "Applied, NOT confirmed: the revert runs ${REVERT_AFTER}s after it was armed, or at the next boot."
  say "Now, from a NEW session over the tailnet: log in by key, and validate the"
  say "server in Coolify (Servers > localhost > Validate). Then, within the window:"
  say "  sudo $INSTALLED_BIN confirm"
}

clear_pending() {
  run systemctl disable "$BOOT_REVERT_UNIT"
  state_remove "$STATE_DIR/pending" "$STAGE_DIR" "$STATE_DIR/unit-was-enabled" \
    "$STATE_DIR/sshd-dropin.before" "$STATE_DIR/sshd-dropin.absent"
}

do_confirm() {
  require_root
  [[ -f $STATE_DIR/pending ]] || die "nothing to confirm (already confirmed, or reverted)"
  SRC_DIR=$STAGE_DIR
  load_config "$STAGE_DIR/host.env"
  if pending_has firewall; then
    resolve_coolify || load_recorded_coolify || die "the Coolify bridge is unknown"
    firewall_in_force || die "the firewall is not what was applied: run '$INSTALLED_BIN revert' and apply again"
  fi
  if pending_has sshd; then
    sshd_hardened || die "sshd -T does not show the hardened values: run '$INSTALLED_BIN revert'"
  fi
  if revert_armed; then
    run systemctl stop "$REVERT_UNIT.timer"
  fi
  if pending_has firewall; then
    put_file "$STAGE_DIR/firewall/shift-v4.rules" "$SHARE_DIR/firewall/shift-v4.rules" 0644
    put_file "$STAGE_DIR/firewall/shift-v6.rules" "$SHARE_DIR/firewall/shift-v6.rules" 0644
    if [[ -f $STAGE_DIR/host.env ]]; then
      put_file "$STAGE_DIR/host.env" "$CONF_DIR/host.env" 0600
    fi
    run systemctl enable "$UNIT_NAME"
  fi
  clear_pending
  say "Confirmed. $UNIT_NAME re-applies the confirmed firewall at boot."
}

# Back to the last confirmed state. Runs to the end even if a step fails, so
# one failure never leaves sshd unrestored; the failures are reported.
do_revert() {
  require_root
  local failed=0 everything=0
  if [[ ! -f $STATE_DIR/pending ]]; then
    [[ $FROM_TIMER -eq 0 ]] || return 0
    say "Nothing is pending: removing the whole hardening (firewall and sshd drop-in)."
    everything=1
  fi
  set +e
  if [[ $everything -eq 1 ]] || pending_has firewall; then
    if [[ $everything -eq 0 && -f $STATE_DIR/unit-was-enabled && -f $SHARE_DIR/firewall/shift-v4.rules ]]; then
      say "Restoring the last confirmed firewall."
      (
        set -e
        SRC_DIR=$SHARE_DIR
        load_config "$CONF_DIR/host.env"
        resolve_coolify || load_recorded_coolify || die "the Coolify bridge is unknown"
        load_firewall 0
      ) || failed=1
      run systemctl enable "$UNIT_NAME" || failed=1
    else
      say "Removing the SHIFT-* chains and their jumps."
      (
        set -e
        unload_firewall
      ) || failed=1
      run systemctl disable "$UNIT_NAME" 2>/dev/null
    fi
  fi
  if [[ $everything -eq 1 ]]; then
    if [[ -f $SSHD_DROPIN ]]; then
      run rm -f -- "$SSHD_DROPIN" || failed=1
    fi
    run systemctl try-reload-or-restart "$SSH_SERVICE" || failed=1
  elif pending_has sshd; then
    restore_sshd_dropin || failed=1
    run systemctl try-reload-or-restart "$SSH_SERVICE" || failed=1
  fi
  if [[ $FROM_TIMER -eq 0 ]] && revert_armed; then
    run systemctl stop "$REVERT_UNIT.timer" || failed=1
  fi
  clear_pending
  set -e
  if [[ $failed -eq 1 ]]; then
    die "the revert did not complete; check '$INSTALLED_BIN status' from the console"
  fi
  say "Reverted to the last confirmed state."
}

# ------------------------------------------------------------------- main ----

do_status() {
  require_root
  say "revert timer: $(revert_armed && echo armed || echo none)"
  say "pending: $( [[ -f $STATE_DIR/pending ]] && tr '\n' ' ' <"$STATE_DIR/pending" || echo none)"
  local fam
  for fam in 4 6; do
    say "IPv$fam INPUT jump: $(jump_count "$fam" INPUT SHIFT-INPUT), DOCKER-USER jump: $(jump_count "$fam" DOCKER-USER SHIFT-DOCKER-USER)"
    "$(ipt_of "$fam")" -w -S SHIFT-INPUT 2>/dev/null || true
    "$(ipt_of "$fam")" -w -S SHIFT-DOCKER-USER 2>/dev/null || true
  done
  say "sshd: passwordauthentication $(sshd_effective passwordauthentication), permitrootlogin $(sshd_effective permitrootlogin)"
  say "swap: $(swapon --show=NAME,SIZE --noheadings | tr '\n' ' '), vm.swappiness $(sysctl -n vm.swappiness)"
  say "units: $UNIT_NAME $(systemctl is-enabled "$UNIT_NAME" 2>/dev/null || echo absent), $BOOT_REVERT_UNIT $(systemctl is-enabled "$BOOT_REVERT_UNIT" 2>/dev/null || echo absent)"
}

parse_args() {
  if [[ $# -gt 0 ]]; then
    case $1 in
      plan | apply | confirm | revert | status | render | boot)
        MODE=$1
        shift
        ;;
    esac
  fi
  while [[ $# -gt 0 ]]; do
    case $1 in
      --env)
        [[ $# -ge 2 ]] || die "--env needs a file"
        ENV_FILE=$2
        [[ -f $ENV_FILE ]] || die "no such env file: $ENV_FILE"
        shift 2
        ;;
      --revert-after)
        [[ $# -ge 2 ]] || die "--revert-after needs seconds"
        REVERT_AFTER_ARG=$2
        shift 2
        ;;
      --allow-ssh-session)
        ALLOW_SSH_SESSION=1
        shift
        ;;
      --from-timer | --at-boot)
        FROM_TIMER=1
        shift
        ;;
      all)
        COMPONENTS=("${ALL_COMPONENTS[@]}")
        shift
        ;;
      firewall | sshd | swap | upgrades | coolify)
        [[ $MODE == plan || $MODE == apply ]] || die "$1 is a component of plan or apply, not of $MODE"
        COMPONENTS+=("$1")
        shift
        ;;
      4 | 6)
        [[ $MODE == render ]] || die "$1 is a family for render, not a component"
        RENDER_FAMILIES+=("$1")
        shift
        ;;
      -h | --help)
        sed -n '2,33p' "$SELF"
        exit 0
        ;;
      *) die "unknown argument: $1 (see --help)" ;;
    esac
  done
  if [[ ${#COMPONENTS[@]} -gt 0 && $MODE != plan && $MODE != apply ]]; then
    die "components are for plan or apply, not for $MODE"
  fi
  if [[ -n $ENV_FILE && $MODE != plan && $MODE != apply && $MODE != render ]]; then
    die "--env is for plan, apply or render; $MODE uses $CONF_DIR/host.env"
  fi
}

has_component() {
  local want=$1 c
  for c in "${COMPONENTS[@]}"; do
    [[ $c == "$want" ]] && return 0
  done
  return 1
}

main() {
  parse_args "$@"
  if [[ -f $SELF_DIR/firewall/shift-v4.rules ]]; then
    SRC_DIR=$SELF_DIR
  else
    SRC_DIR=$SHARE_DIR
  fi
  case $MODE in
    render)
      load_config "${ENV_FILE:-$CONF_DIR/host.env}"
      resolve_coolify || die "Docker network '$COOLIFY_NETWORK' not found; pin COOLIFY_BRIDGE and COOLIFY_SUBNET4 in the env file to render without Docker"
      [[ ${#RENDER_FAMILIES[@]} -gt 0 ]] || RENDER_FAMILIES=(4 6)
      local fam
      for fam in "${RENDER_FAMILIES[@]}"; do render_family "$fam"; done
      ;;
    boot)
      require_root
      APPLY=1
      SRC_DIR=$SHARE_DIR
      load_config "$CONF_DIR/host.env"
      if ! resolve_coolify && ! load_recorded_coolify; then
        warn "the Coolify bridge is unknown: loading the rules WITHOUT Coolify's SSH admission"
      fi
      load_firewall 0
      ;;
    confirm)
      APPLY=1
      do_confirm
      ;;
    revert)
      APPLY=1
      SRC_DIR=$SHARE_DIR
      load_config "$CONF_DIR/host.env"
      do_revert
      ;;
    status)
      load_config "$CONF_DIR/host.env"
      do_status
      ;;
    plan | apply)
      require_root
      load_config "${ENV_FILE:-$CONF_DIR/host.env}"
      if [[ $MODE == apply ]]; then
        [[ ${#COMPONENTS[@]} -gt 0 ]] || die "name what to apply: firewall sshd swap upgrades coolify, or all"
        APPLY=1
      elif [[ ${#COMPONENTS[@]} -eq 0 ]]; then
        COMPONENTS=("${ALL_COMPONENTS[@]}")
      fi
      GUARDED=()
      if has_component firewall; then GUARDED+=(firewall); fi
      if has_component sshd; then GUARDED+=(sshd); fi
      if [[ $APPLY -eq 1 && ${#GUARDED[@]} -gt 0 ]]; then
        if in_ssh_session && [[ $ALLOW_SSH_SESSION -eq 0 ]]; then
          die "this is an SSH session; apply the firewall and sshd from the provider's console (or pass --allow-ssh-session)"
        fi
        if revert_armed || [[ -f $STATE_DIR/pending ]]; then
          die "an unconfirmed change is pending: confirm or revert it first"
        fi
        # The revert is armed BEFORE anything changes, so a component that
        # fails half-way is still undone.
        prepare_guarded_apply
      fi
      local c
      for c in "${COMPONENTS[@]}"; do
        "component_$c"
      done
      if [[ $APPLY -eq 1 && ${#GUARDED[@]} -gt 0 ]]; then
        confirm_hint
      fi
      if [[ $APPLY -eq 0 ]]; then
        if [[ $DRIFT -eq 1 ]]; then
          say ""
          say "Changes pending. Nothing was changed."
          exit 3
        fi
        say ""
        say "Nothing to change."
      fi
      ;;
  esac
}

main "$@"
