#!/usr/bin/env bash
#
# Drive a cutie Pi over SSH from a development machine.
#
#   provisioner/pi.sh <host> <verb>
#
# An ARMv6 board is too constrained to develop on - a Pi Zero W has 427 MB of
# RAM and a single core - so work happens on a development machine and reaches
# the Pi through this script.
#
# Verbs:
#   probe      report kernel, Node, buses, service state, I2C addresses
#   deploy     build locally, rsync built/ to the Pi, retain the previous build,
#              restart the service
#   install    clean on-device npm install (production dependencies only)
#   rollback   restore the retained previous build and restart
#   restart    restart the service
#   status     systemctl status for the service
#   logs       follow the service journal
#   converge   apply configure-host.sh to the Pi

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$HERE")"

REMOTE_DIR="/home/pi/workspace/cutie"
REMOTE_BUILT="${REMOTE_DIR}/built"
REMOTE_PREVIOUS="${REMOTE_DIR}/built.previous"
REMOTE_LOG="/home/pi/logs/npm-ci.log"
DONE_MARKER="cutie-install-exit:"
SERVICE="cutie"

usage() {
  sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'
  exit "${1:-2}"
}

[ "$#" -ge 2 ] || usage
HOST="$1"
VERB="$2"
shift 2

on_pi() {
  # SC2029: the command string is built here and is meant to expand remotely.
  # Every path in it is a constant defined above, none comes from user input.
  # shellcheck disable=SC2029
  ssh "$HOST" "$@"
}

verb_probe() {
  # A single here-doc, so this is one round trip rather than a dozen.
  on_pi 'bash -s' <<'PROBE'
set -u
# i2cdetect and friends live in /usr/sbin, which is not on a non-login PATH.
PATH="/usr/sbin:/sbin:$PATH"
echo "== host"
hostname; uname -srm; cat /etc/os-release | grep ^PRETTY_NAME=
echo
echo "== node"
node --version 2>/dev/null || echo "node: not installed"
npm --version 2>/dev/null || echo "npm: not installed"
echo
echo "== memory and swap"
free -m
echo
echo "== buses"
ls /dev/i2c-* 2>/dev/null || echo "no i2c devices"
ls /dev/spidev* 2>/dev/null || echo "no spi devices"
echo
echo "== i2c bus 1"
if command -v i2cdetect >/dev/null 2>&1 && [ -e /dev/i2c-1 ]; then
  i2cdetect -y 1
else
  echo "i2cdetect unavailable or /dev/i2c-1 missing"
fi
echo
echo "== gpio sysfs base"
cat /sys/class/gpio/gpiochip*/base 2>/dev/null || echo "no gpiochip in sysfs"
echo
echo "== service"
systemctl is-enabled cutie 2>/dev/null || true
systemctl is-active cutie 2>/dev/null || true
echo
echo "== native modules"
# Only build/Release/*.node is reported. Packages like serialport and deasync
# vendor prebuilds for every platform they support, and listing those says
# nothing about this host - what matters is what a require() here would load.
if [ -d /home/pi/workspace/cutie/node_modules ]; then
  found=0
  for object in /home/pi/workspace/cutie/node_modules/*/build/Release/*.node; do
    [ -e "$object" ] || continue
    found=1
    printf '%-40s %s\n' \
      "$(echo "$object" | sed 's|.*/node_modules/||; s|/build/Release/| |')" \
      "$(file -b "$object" | cut -d, -f1-2)"
  done
  [ "$found" -eq 1 ] || echo "no compiled modules under build/Release"
else
  echo "node_modules absent"
fi
PROBE
}

verb_deploy() {
  echo "== building locally"
  (cd "$REPO" && npm run build)

  echo "== retaining current build as built.previous"
  # Kept so rollback is one command: cutie.service sets Restart=always, which
  # turns a bad deploy into a crash loop.
  on_pi "rm -rf '${REMOTE_PREVIOUS}' && \
         if [ -d '${REMOTE_BUILT}' ]; then cp -a '${REMOTE_BUILT}' '${REMOTE_PREVIOUS}'; fi"

  echo "== syncing built/"
  # built/ only. node_modules is never copied: native modules are compiled per
  # architecture and per Node ABI, so a copy from here lands unloadable
  # binaries on the Pi.
  rsync -az --delete "${REPO}/built/" "${HOST}:${REMOTE_BUILT}/"

  verb_restart
}

verb_install() {
  # --omit=dev is not an optimisation, it is required on ARMv6. esbuild's
  # linux-arm prebuild is compiled for ARMv7 and dies with SIGILL in its own
  # postinstall; it arrives via tsx, a devDependency. npm cleans up node_modules
  # on failure, so without this the whole ~12 minutes of native compiling is
  # thrown away at the very last step.
  #
  # Nothing on a Pi needs the dev tooling: start:prod runs built/ under node.
  echo "== clean install on ${HOST} (native modules compile here; expect 15-30 min)"
  echo "   logging to ${REMOTE_LOG}"

  # Detached with setsid so an SSH drop cannot kill a long install midway, and
  # logged to a file so the output survives the connection either way. The
  # trailing sentinel is what completion is detected by: polling for the npm
  # process instead would match the polling command's own `pgrep -f "npm ci"`
  # command line and never terminate.
  on_pi "cd '${REMOTE_DIR}' && rm -rf node_modules '${REMOTE_LOG}' && \
         nohup setsid sh -c 'npm ci --omit=dev --foreground-scripts; \
           echo \"${DONE_MARKER}\$?\"' > '${REMOTE_LOG}' 2>&1 < /dev/null & \
         echo started"

  local status=""
  while [ -z "$status" ]; do
    sleep 30
    status="$(on_pi "grep -o '${DONE_MARKER}[0-9]*' '${REMOTE_LOG}' 2>/dev/null || true")"
    [ -n "$status" ] || on_pi "tail -1 '${REMOTE_LOG}'"
  done

  if [ "$status" = "${DONE_MARKER}0" ]; then
    echo "== install finished"
    on_pi "tail -3 '${REMOTE_LOG}'"
  else
    echo "== install FAILED (${status})" >&2
    on_pi "tail -30 '${REMOTE_LOG}'" >&2
    return 1
  fi
}

verb_rollback() {
  on_pi "test -d '${REMOTE_PREVIOUS}'" || {
    echo "no retained build at ${REMOTE_PREVIOUS}; nothing to roll back to" >&2
    exit 1
  }
  echo "== restoring built.previous"
  on_pi "rm -rf '${REMOTE_BUILT}' && mv '${REMOTE_PREVIOUS}' '${REMOTE_BUILT}'"
  verb_restart
}

verb_restart() {
  echo "== restarting ${SERVICE}"
  on_pi "sudo systemctl restart ${SERVICE}"
  # The namespaced journal only exists once a unit carrying LogNamespace is
  # installed, so a host still running an older unit must not fail here.
  on_pi "sudo systemctl restart systemd-journald@${SERVICE}.service 2>/dev/null || true"
  sleep 2
  on_pi "systemctl is-active ${SERVICE}"
}

verb_status() {
  on_pi "systemctl status ${SERVICE} --no-pager" || true
}

verb_logs() {
  on_pi "sudo journalctl -u ${SERVICE} --namespace=${SERVICE} --follow"
}

verb_converge() {
  echo "== applying configure-host.sh to ${HOST}"
  on_pi 'sudo bash -s' <"${HERE}/configure-host.sh"
}

case "$VERB" in
probe) verb_probe ;;
deploy) verb_deploy ;;
install) verb_install ;;
rollback) verb_rollback ;;
restart) verb_restart ;;
status) verb_status ;;
logs) verb_logs ;;
converge) verb_converge ;;
-h | --help | help) usage 0 ;;
*)
  echo "unknown verb: ${VERB}" >&2
  usage
  ;;
esac
