#!/bin/sh
# Orb Server's admin helper. The installer copies this file, owned by root (0755), to /usr/local/libexec/orb-server-admin
# and lets the Orb Server user run it, and nothing else, with sudo (/etc/sudoers.d/orb-server). The engine calls it only
# after the person approved the action on a card; agents and bots never can (their processes have no_new_privs, and the
# guard refuses sudo). It does a fixed list of actions and checks every value again by itself:
#   docker-restart <container>      docker restart
#   docker-pull <container>         docker pull of the image the container runs
#   systemctl-restart <unit>        systemctl restart, only for a unit listed in /etc/orb-server/units.allow (root-owned)
#   journal-vacuum <size>           journalctl --vacuum-size, 2G at most (e.g. 500M)
#   apt-clean                       apt-get clean
# The expressions below are the same as in src/server/admin-verbs.mjs (a test checks it).
set -eu
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 022
LC_ALL=C
export LC_ALL

UNITS_ALLOW=/etc/orb-server/units.allow
NAME_RE='^[A-Za-z0-9][A-Za-z0-9_.@-]{0,99}$'
SIZE_RE='^[1-9][0-9]{0,3}[MG]$'
IMAGE_RE='^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$'

# Dry mode (tests): prints the command instead of running it. Never as root: sudo would not pass the variable anyway.
DRY=''
if [ -n "${ORB_ADMIN_DRY:-}" ] && [ "$(id -u 2>/dev/null || echo 0)" != 0 ]; then
  DRY=1
  [ -n "${ORB_ADMIN_UNITS:-}" ] && UNITS_ALLOW=$ORB_ADMIN_UNITS
fi

die() { echo "orb-server-admin: $*" >&2; exit 64; }
matches() {
  case "$1" in *'
'*) return 1 ;; esac
  printf '%s\n' "$1" | grep -Eq -- "$2"
}
run() {
  if [ -n "$DRY" ]; then printf '%s\n' "$*"; exit 0; fi
  exec "$@"
}

[ "$#" -ge 1 ] || die "usage: orb-server-admin docker-restart|docker-pull|systemctl-restart|journal-vacuum|apt-clean [value]"
verb=$1
shift

case "$verb" in
  docker-restart)
    [ "$#" -eq 1 ] || die "one name"
    matches "$1" "$NAME_RE" || die "bad container name"
    run docker restart -- "$1"
    ;;
  docker-pull)
    [ "$#" -eq 1 ] || die "one name"
    matches "$1" "$NAME_RE" || die "bad container name"
    if [ -n "$DRY" ]; then image="image-of-$1"; else image=$(docker inspect --format '{{.Config.Image}}' -- "$1"); fi
    matches "$image" "$IMAGE_RE" || die "bad image"
    run docker pull -- "$image"
    ;;
  systemctl-restart)
    [ "$#" -eq 1 ] || die "one unit"
    matches "$1" "$NAME_RE" || die "bad unit name"
    [ -f "$UNITS_ALLOW" ] || die "unit not allowed"
    grep -Fxq -- "$1" "$UNITS_ALLOW" || die "unit not allowed"
    run systemctl restart -- "$1"
    ;;
  journal-vacuum)
    [ "$#" -eq 1 ] || die "one size"
    matches "$1" "$SIZE_RE" || die "bad size"
    n=${1%?}
    unit=${1#"$n"}
    if [ "$unit" = G ]; then mb=$((n * 1024)); else mb=$n; fi
    [ "$mb" -le 2048 ] || die "at most 2G"
    run journalctl --vacuum-size="$1"
    ;;
  apt-clean)
    [ "$#" -eq 0 ] || die "no arguments"
    run apt-get clean
    ;;
  *)
    die "unknown action"
    ;;
esac
