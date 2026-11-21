#!/usr/bin/env bash
# Story 20.4: verify, from OUTSIDE the host, that only the web answers.
#
# Run it as root (nmap's UDP scan needs it) on a machine that is not the host
# and does not reach the internet through the host (no exit node on it). Needs
# nmap and curl; ssh and pg_isready for the tailnet checks that name them.
#
#   sudo verify-exposure.sh --ipv4 <public IPv4> --ipv6 <public IPv6> \
#     [--tailnet-host <the host's tailnet name>] [--coolify-port <port>] \
#     [--studio-url <Studio's tailscale-serve URL>] [--postgres-port <port>] \
#     [--ssh-user root] [--tailscale-udp-port <host.env's TAILSCALE_UDP_PORT>]
#
# Public half, for EACH address:
# - a full TCP scan (1-65535) finds exactly 80 and 443 open, so SSH, the
#   Coolify UI and its realtime and terminal ports, Traefik's dashboard,
#   Studio and Postgres do not answer;
# - a UDP scan of the ports a host commonly serves (and Tailscale's) finds
#   nothing open but 443 (and Tailscale's port, which answers only to its
#   peers). It is a probe of those ports only, and a UDP service that does not
#   answer nmap reads as open|filtered, like a dropped port: the TCP scan and
#   the rules themselves are the proof that nothing else is exposed;
# - 443/udp answers HTTP/3, when this curl supports it.
# If this machine has no IPv6 route, the IPv6 checks FAIL, never skip.
#
# Tailnet half (with --tailnet-host): SSH offers public-key authentication
# ONLY (a password is refused), and key login works; the Coolify UI, Studio
# and Postgres answer when their options are given (Studio and Postgres exist
# on the tailnet once story 20.5 has stood a stack up).
#
# Exit status: 0 when every check passed, 1 when one failed, 2 on bad usage.
# Nothing is changed anywhere; this script only connects.
set -euo pipefail

IPV4=""
IPV6=""
TAILNET_HOST=""
COOLIFY_PORT=""
STUDIO_URL=""
POSTGRES_PORT=""
SSH_USER=root
TAILSCALE_UDP_PORT=41641
FAILED=0
readonly COMMON_UDP_PORTS=53,67,68,69,123,137,161,443,500,1900,4500,5353,11211

pass() { printf 'PASS  %s\n' "$*"; }
fail() {
  FAILED=1
  printf 'FAIL  %s\n' "$*"
}
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --ipv4 | --ipv6 | --tailnet-host | --coolify-port | --studio-url | --postgres-port | --ssh-user | --tailscale-udp-port)
      [[ $# -ge 2 && -n $2 ]] || die "$1 needs a value"
      case $1 in
        --ipv4) IPV4=$2 ;;
        --ipv6) IPV6=$2 ;;
        --tailnet-host) TAILNET_HOST=$2 ;;
        --coolify-port) COOLIFY_PORT=$2 ;;
        --studio-url) STUDIO_URL=$2 ;;
        --postgres-port) POSTGRES_PORT=$2 ;;
        --ssh-user) SSH_USER=$2 ;;
        --tailscale-udp-port) TAILSCALE_UDP_PORT=$2 ;;
      esac
      shift 2
      ;;
    -h | --help)
      sed -n '2,28p' "$0"
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n $IPV4 && -n $IPV6 ]] || die "--ipv4 and --ipv6 are both required: the AC scans both families"
[[ $IPV4 =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "--ipv4 is not an IPv4 address: $IPV4"
[[ $IPV6 =~ ^[0-9A-Fa-f:]+$ && $IPV6 == *:* ]] || die "--ipv6 is not an IPv6 address: $IPV6"
[[ -z $COOLIFY_PORT || $COOLIFY_PORT =~ ^[0-9]{1,5}$ ]] || die "--coolify-port is not a port"
[[ -z $POSTGRES_PORT || $POSTGRES_PORT =~ ^[0-9]{1,5}$ ]] || die "--postgres-port is not a port"
[[ $TAILSCALE_UDP_PORT =~ ^[0-9]{1,5}$ ]] || die "--tailscale-udp-port is not a port"
readonly UDP_PORTS=$COMMON_UDP_PORTS,$TAILSCALE_UDP_PORT
[[ $(id -u) -eq 0 ]] || die "run as root: nmap's UDP scan needs it"
command -v nmap >/dev/null || die "nmap is required"
command -v curl >/dev/null || die "curl is required"

# Prints the open ports of one address for one protocol, comma-separated.
open_ports() {
  local family=$1 address=$2 proto=$3 output
  local -a how=(-p 1-65535)
  [[ $proto == udp ]] && how=(-sU -p "$UDP_PORTS")
  if ! output=$(nmap "$family" -Pn -n "${how[@]}" -T4 --max-retries 2 --host-timeout 45m --open -oG - -- "$address" 2>&1); then
    printf 'SCAN-FAILED: %s\n' "$output" >&2
    return 1
  fi
  if grep -q 'Status: Timeout\|0 hosts up' <<<"$output"; then
    return 1
  fi
  printf '%s\n' "$output" | sed -n 's/.*Ports: //p' | tr ',' '\n' |
    sed -n "s#^ *\([0-9]*\)/open/$proto.*#\1#p" | sort -n | paste -sd, -
}

scan() {
  local label=$1 family=$2 address=$3 ports port
  if ! ports=$(open_ports "$family" "$address" tcp); then
    fail "$label: the TCP scan did not run or timed out (no route from here?)"
  elif [[ $ports == "80,443" ]]; then
    pass "$label: only 80 and 443 answer on TCP"
  else
    fail "$label: open TCP ports are '${ports:-none}', expected exactly 80,443"
  fi
  # A UDP port that does not answer reads as open|filtered, not open; only an
  # answer is "open". 443 (HTTP/3) and Tailscale's port may answer.
  if ! ports=$(open_ports "$family" "$address" udp); then
    fail "$label: the UDP scan did not run or timed out"
  else
    local unexpected=""
    for port in ${ports//,/ }; do
      [[ $port == 443 || $port == "$TAILSCALE_UDP_PORT" ]] || unexpected+="$port "
    done
    if [[ -z $unexpected ]]; then
      pass "$label: of the UDP ports probed ($UDP_PORTS), none answers but 443 (and Tailscale's)"
    else
      fail "$label: UDP ports answer: $unexpected"
    fi
  fi
}

http3() {
  local label=$1 url=$2
  if curl --http3-only -sk -o /dev/null --max-time 15 "$url"; then
    pass "$label: 443/udp answers HTTP/3"
  else
    fail "$label: 443/udp does not answer HTTP/3"
  fi
}

scan "IPv4 $IPV4" -4 "$IPV4"
scan "IPv6 $IPV6" -6 "$IPV6"

if curl --version | grep -qw HTTP3; then
  http3 "IPv4 $IPV4" "https://$IPV4/"
  v6host="[$IPV6]"
  http3 "IPv6 $IPV6" "https://$v6host/"
else
  printf 'NOTE  this curl has no HTTP/3: 443/udp answering HTTP/3 not probed\n'
fi

if [[ -n $TAILNET_HOST ]]; then
  command -v ssh >/dev/null || fail "ssh is missing: SSH over the tailnet not checked"
  if command -v ssh >/dev/null; then
    ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
    # The methods sshd offers before any credential: publickey, and nothing else.
    methods=$(ssh "${ssh_opts[@]}" -o PreferredAuthentications=none -v "$SSH_USER@$TAILNET_HOST" true 2>&1 |
      sed -n 's/.*Authentications that can continue: //p' | head -n1 || true)
    if [[ $methods == publickey ]]; then
      pass "SSH over the tailnet offers publickey only (a password is refused)"
    else
      fail "SSH over the tailnet offers '${methods:-nothing}', expected exactly publickey"
    fi
    if ssh "${ssh_opts[@]}" -o PasswordAuthentication=no "$SSH_USER@$TAILNET_HOST" true 2>/dev/null; then
      pass "SSH by key works over the tailnet"
    else
      fail "SSH by key over the tailnet failed"
    fi
  fi
  if [[ -n $COOLIFY_PORT ]]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$TAILNET_HOST:$COOLIFY_PORT/" || true)
    if [[ $code =~ ^(200|301|302)$ ]]; then
      pass "Coolify UI answers over the tailnet ($code)"
    else
      fail "Coolify UI over the tailnet answered '$code'"
    fi
  fi
  if [[ -n $POSTGRES_PORT ]]; then
    if command -v pg_isready >/dev/null && pg_isready -q -t 10 -h "$TAILNET_HOST" -p "$POSTGRES_PORT"; then
      pass "Postgres answers over the tailnet"
    else
      fail "Postgres over the tailnet did not answer (or pg_isready is missing)"
    fi
  fi
fi
if [[ -n $STUDIO_URL ]]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$STUDIO_URL" || true)
  if [[ $code =~ ^(200|301|302|307|308)$ ]]; then
    pass "Studio answers over the tailnet ($code)"
  else
    fail "Studio over the tailnet answered '$code'"
  fi
fi

exit "$FAILED"
