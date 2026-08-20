#!/usr/bin/env bash
#
# Converge a Raspberry Pi onto the host configuration cutie expects.
#
# This script is the single definition of the convergent half of provisioning:
# bus enablement, swap, packages, Node, and the cutie service. It is idempotent,
# so re-running it is a no-op, and it is driven from two places:
#
#   image build   sdm --cscript provisioner/configure-host.sh
#                 sdm calls it with a phase argument of 0, 1, or post-install.
#   live host     ssh <host> 'sudo bash -s' < provisioner/configure-host.sh
#                 No argument. Runs against a booted Pi over SSH.
#
# Identity configuration - user password, wifi, SSH keys, sshd - is deliberately
# NOT here. Those are image-time sdm plugins only, because getting one wrong
# strands an unreachable headless host. Everything in this script is safe to
# re-apply to a running Pi.
#
# The script must stay self-contained: the live invocation pipes it over stdin,
# so it cannot source or exec a sibling file.
#
# Linux only (Raspberry Pi OS). GNU sed in-place editing is used deliberately.

set -euo pipefail

NODE_VERSION="22.23.2"
SWAP_MB="2048"
CUTIE_USER="pi"
CUTIE_HOME="/home/pi"
CUTIE_DIR="${CUTIE_HOME}/workspace/cutie"
# build-essential and python3 are what node-gyp needs to compile the four native
# modules. Raspberry Pi OS Lite ships both today, so naming them here costs
# nothing - install_packages skips anything already present - but it turns a
# future base image dropping them into an apt install rather than an obscure
# node-gyp failure.
PACKAGES="git i2c-tools pigpio build-essential python3"
HW_GROUPS="i2c spi gpio"
LOGIN_SHELL="/bin/bash"
NODE_PREFIX="/usr/local/node"
RPI_SWAP_DROPIN="/etc/rpi/swap.conf.d/99-cutie-swap.conf"
I2C_MODULE_CONF="/etc/modules-load.d/cutie-i2c.conf"
SUDOERS_FILE="/etc/sudoers.d/010_pi-nopasswd"

changed=0
reboot_reasons=""

log() { printf '[configure-host] %s\n' "$*"; }
note_change() {
  changed=$((changed + 1))
  log "CHANGED: $*"
}

# Record that a change only takes effect after a reboot, so the summary can name
# the specific reasons instead of warning unconditionally.
needs_reboot() {
  case " ${reboot_reasons} " in
  *" $1 "*) ;;
  *) reboot_reasons="${reboot_reasons} $1" ;;
  esac
}

# sdm runs the custom phase script three times. Phases 0 and 1 both run before
# sdm's own plugins have staged anything into the image - in particular before
# copydir has placed the cutie checkout - so the real work happens in
# post-install, which runs after every phase 1 plugin. An empty argument means
# the live-host path.
phase="${1:-live}"
case "$phase" in
0 | 1)
  exit 0
  ;;
post-install)
  # Inside sdm's nspawn container. Configuration files can be written and units
  # enabled, but nothing can be started, so service restarts are skipped.
  live="no"
  ;;
live)
  live="yes"
  ;;
*)
  echo "usage: configure-host.sh [0|1|post-install]" >&2
  exit 2
  ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "configure-host.sh must run as root" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Boot config: I2C for the BME680, SPI for both HATs.
# ---------------------------------------------------------------------------

find_config_txt() {
  local candidate
  for candidate in /boot/firmware/config.txt /boot/config.txt; do
    if [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

ensure_dtparam() {
  local file="$1" key="$2" value="$3"

  if grep -Eq "^[[:space:]]*dtparam=${key}=${value}([[:space:]]|$)" "$file"; then
    return 0
  fi

  if grep -Eq "^[[:space:]]*#?[[:space:]]*dtparam=${key}=" "$file"; then
    # An existing line - commented out or set to another value - is rewritten in
    # place so it keeps its position relative to any [board] section headers.
    sed -i -E "s|^[[:space:]]*#?[[:space:]]*dtparam=${key}=.*|dtparam=${key}=${value}|" "$file"
  else
    printf '\n# added by cutie configure-host.sh\ndtparam=%s=%s\n' "$key" "$value" >>"$file"
  fi
  note_change "dtparam=${key}=${value} in ${file}"
}

# dtparam=i2c_arm=on loads the bus controller (i2c_bcm2835) but does NOT create
# /dev/i2c-*. That needs the separate i2c-dev module, which raspi-config would
# normally add to /etc/modules - and a headless image never runs raspi-config.
# Without it the bus is live but userspace has nothing to open, so i2cdetect and
# the BME680 both fail with the hardware working perfectly.
configure_i2c_dev() {
  if [ -f "$I2C_MODULE_CONF" ] && grep -qx "i2c-dev" "$I2C_MODULE_CONF"; then
    return 0
  fi

  mkdir -p "$(dirname "$I2C_MODULE_CONF")"
  printf '# Written by cutie configure-host.sh\ni2c-dev\n' >"$I2C_MODULE_CONF"
  note_change "enabled i2c-dev via ${I2C_MODULE_CONF}"

  if [ "$live" = "yes" ]; then
    modprobe i2c-dev || log "WARNING: modprobe i2c-dev failed; a reboot will load it"
  fi
}

configure_boot_config() {
  local config_txt
  if ! config_txt="$(find_config_txt)"; then
    log "WARNING: no config.txt found; skipping bus enablement"
    return 0
  fi

  if [ ! -f "${config_txt}.cutie-backup" ]; then
    cp -a "$config_txt" "${config_txt}.cutie-backup"
    note_change "backed up ${config_txt} to ${config_txt}.cutie-backup"
  fi

  ensure_dtparam "$config_txt" "i2c_arm" "on"
  ensure_dtparam "$config_txt" "spi" "on"
}

# ensure_dtparam bumps `changed` when it edits, so compare before and after to
# decide whether config.txt actually needs a reboot this run.
configure_boot_config_checked() {
  local before="$changed"
  configure_boot_config
  [ "$changed" -ne "$before" ] && needs_reboot "config.txt"
  return 0
}

# ---------------------------------------------------------------------------
# Swap. Bookworm uses dphys-swapfile; Trixie may use rpi-swap instead. Which one
# is installed is detected rather than assumed, because the fleet spans both.
#
# sdm's own `system` plugin swap= argument is not used for this: it tests
# `ispkginstalled dphy-swapfile` (missing the s), so on any dphys-swapfile host
# it silently does nothing.
# ---------------------------------------------------------------------------

configure_swap_rpi() {
  # Mechanism matters as much as the size. rpi-swap defaults to `auto`, which
  # currently resolves to `zram+file` - and there the File section sizes a
  # WRITEBACK file, not a swap device, so setting FixedSizeMiB alone leaves real
  # swap as zram at RAM size (426 MB here) while appearing to have worked.
  # `swapfile` is the mechanism that gives a genuine SWAP_MB swap file, matching
  # what dphys-swapfile provides on Bookworm.
  #
  # A drop-in only needs the keys it overrides, so this is written outright
  # rather than copied from the base config and patched.
  local desired
  desired="$(
    cat <<EOF
# Written by cutie configure-host.sh
[Main]
Mechanism=swapfile

[File]
FixedSizeMiB=${SWAP_MB}
MaxSizeMiB=${SWAP_MB}
EOF
  )"

  if [ -f "$RPI_SWAP_DROPIN" ] && [ "$desired" = "$(cat "$RPI_SWAP_DROPIN")" ]; then
    return 0
  fi

  mkdir -p "$(dirname "$RPI_SWAP_DROPIN")"
  printf '%s\n' "$desired" >"$RPI_SWAP_DROPIN"
  note_change "rpi-swap mechanism=swapfile size=${SWAP_MB}MiB"

  # There is no rpi-swap service to restart. rpi-swap is implemented as a
  # systemd generator that reads this config at boot and emits units from it -
  # `dev-zram0.swap` shows up as "generated" in list-unit-files. Switching
  # mechanism therefore only takes effect on the next boot.
  needs_reboot "swap mechanism"
}

configure_swap_dphys() {
  local before
  before="$(cat /etc/dphys-swapfile)"

  # CONF_MAXSWAP caps CONF_SWAPSIZE and ships commented out at its 2048 default.
  # Setting it explicitly makes the ceiling legible and survives a raised size.
  sed -i -E "s|^[[:space:]]*#?[[:space:]]*CONF_SWAPSIZE=.*|CONF_SWAPSIZE=${SWAP_MB}|" /etc/dphys-swapfile
  sed -i -E "s|^[[:space:]]*#?[[:space:]]*CONF_MAXSWAP=.*|CONF_MAXSWAP=${SWAP_MB}|" /etc/dphys-swapfile

  if [ "$before" = "$(cat /etc/dphys-swapfile)" ]; then
    return 0
  fi
  note_change "dphys-swapfile CONF_SWAPSIZE=${SWAP_MB}"

  systemctl enable dphys-swapfile >/dev/null 2>&1 || true
  if [ "$live" = "yes" ]; then
    # restart runs swapoff, re-creates /var/swap at the new size, then swapon.
    log "restarting dphys-swapfile (this rewrites /var/swap and takes a minute)"
    systemctl restart dphys-swapfile
  fi
}

configure_swap() {
  if [ -f /etc/rpi/swap.conf ]; then
    configure_swap_rpi
  elif [ -f /etc/dphys-swapfile ]; then
    configure_swap_dphys
  else
    log "WARNING: neither rpi-swap nor dphys-swapfile found; skipping swap"
  fi
}

# ---------------------------------------------------------------------------
# Packages. git for deploys, i2c-tools for probing the BME680, pigpio for the
# infrared output steps.
# ---------------------------------------------------------------------------

pkg_installed() {
  [ "$(dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null)" = "installed" ]
}

install_packages() {
  local missing=""
  local pkg
  for pkg in $PACKAGES; do
    if ! pkg_installed "$pkg"; then
      missing="${missing} ${pkg}"
    fi
  done

  if [ -z "$missing" ]; then
    return 0
  fi

  log "installing:${missing}"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  # shellcheck disable=SC2086
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $missing
  note_change "installed${missing}"
}

# ---------------------------------------------------------------------------
# Node. Architecture-aware so one definition serves the whole fleet.
#
# ARMv6 (Pi Zero W) has no official Node build and no build at all past Node 22,
# so 22 is terminal there. arm64 takes the official dist.
# ---------------------------------------------------------------------------

# `uname -m` is WRONG inside sdm's nspawn container: the CPU is emulated by
# qemu-arm, which reports armv7l regardless of the board the image is destined
# for. Trusting it produced an image with an armv7l Node that a Pi Zero W's
# ARMv6 CPU cannot execute - a card that boots but never runs cutie.
#
# dpkg's architecture comes from the image's own configuration rather than the
# CPU, so it is correct both inside the emulated image and on a live host.
target_arch() {
  if command -v dpkg >/dev/null 2>&1; then
    dpkg --print-architecture
    return 0
  fi
  case "$(uname -m)" in
  aarch64 | arm64) echo "arm64" ;;
  *) echo "armhf" ;;
  esac
}

node_url() {
  local arch
  arch="$(target_arch)"
  case "$arch" in
  armhf)
    # Raspberry Pi OS 32-bit is ARMv6-baseline precisely so it runs on Pi 1 and
    # Zero W, so armv6l is right for every 32-bit Pi - and an armv6l binary runs
    # on ARMv7 anyway, while the reverse is not true. There is deliberately no
    # armv7l branch: it could only ever be a downgrade in compatibility.
    printf 'https://unofficial-builds.nodejs.org/download/release/v%s/node-v%s-linux-armv6l.tar.xz' \
      "$NODE_VERSION" "$NODE_VERSION"
    ;;
  arm64)
    printf 'https://nodejs.org/dist/v%s/node-v%s-linux-arm64.tar.xz' \
      "$NODE_VERSION" "$NODE_VERSION"
    ;;
  *)
    echo "unsupported architecture ${arch}" >&2
    return 1
    ;;
  esac
}

install_node() {
  local url tarball tmpdir versioned
  url="$(node_url)"
  tarball="$(basename "$url")"
  versioned="/usr/local/${tarball%.tar.xz}"

  # Compare where the prefix POINTS, not what `node --version` prints. A
  # wrong-architecture install reports the right version quite happily under
  # emulation, and on a live host it fails in a way that is easy to misread.
  # The versioned directory name carries the architecture, so this catches both.
  if [ "$(readlink -f "$NODE_PREFIX" 2>/dev/null)" = "$versioned" ] &&
    [ -x "${versioned}/bin/node" ]; then
    return 0
  fi

  if [ ! -x "${versioned}/bin/node" ]; then
    tmpdir="$(mktemp -d)"
    log "downloading ${url}"
    curl -fsSL -o "${tmpdir}/${tarball}" "$url"
    log "extracting to ${versioned}"
    mkdir -p "$versioned"
    tar -xJf "${tmpdir}/${tarball}" -C "$versioned" --strip-components=1
    rm -rf "$tmpdir"
  fi

  # An earlier provisioner copied Node into /usr/local/node as a real directory.
  # ln -sfn descends into an existing directory and creates the link inside it,
  # which silently leaves /usr/bin/node pointing at the old version, so any
  # non-symlink at the prefix is cleared first.
  if [ -d "$NODE_PREFIX" ] && [ ! -L "$NODE_PREFIX" ]; then
    rm -rf "$NODE_PREFIX"
    note_change "removed legacy directory ${NODE_PREFIX}"
  fi

  ln -sfn "$versioned" "$NODE_PREFIX"
  local binary
  for binary in node npm npx; do
    ln -sfn "${NODE_PREFIX}/bin/${binary}" "/usr/bin/${binary}"
  done
  note_change "node ${NODE_VERSION} at ${versioned}"
}

# ---------------------------------------------------------------------------
# Hardware group membership, so cutie reaches the buses without root.
# ---------------------------------------------------------------------------

configure_groups() {
  local group
  for group in $HW_GROUPS; do
    if ! getent group "$group" >/dev/null 2>&1; then
      continue
    fi
    if id -nG "$CUTIE_USER" 2>/dev/null | tr ' ' '\n' | grep -qx "$group"; then
      continue
    fi
    usermod -aG "$group" "$CUTIE_USER"
    note_change "added ${CUTIE_USER} to group ${group}"
  done
}

# ---------------------------------------------------------------------------
# Login shell.
#
# Raspberry Pi OS ships `pi` with /usr/sbin/nologin as a placeholder, expecting
# piwiz/userconfig.service to replace it on first boot. A headless image must
# disable piwiz, which also disables userconfig.service - so nothing ever fixes
# the shell, and the result is a host that accepts the SSH key and then answers
# every command with "This account is currently not available."
#
# sdm's user plugin cannot do this: `shell=` is only honoured by its `adduser`
# path, and `pi` already exists, so `setpassword` silently ignores it.
# ---------------------------------------------------------------------------

# Stock Raspberry Pi OS grants the first user passwordless sudo via
# /etc/sudoers.d/010_pi-nopasswd, created during piwiz first-boot setup. A
# headless image disables piwiz, so the file never appears and every remote
# admin action - converge, deploy, restart, logs - dies on a password prompt
# that has no terminal to answer it.
#
# Written via a temp file and visudo -c so a syntax error can never land in
# sudoers.d, which would lock sudo out entirely.
configure_sudoers() {
  if [ -f "$SUDOERS_FILE" ] && grep -q "NOPASSWD" "$SUDOERS_FILE"; then
    return 0
  fi

  local tmp
  tmp="$(mktemp)"
  printf '# Written by cutie configure-host.sh\n%s ALL=(ALL) NOPASSWD: ALL\n' \
    "$CUTIE_USER" >"$tmp"

  if ! visudo -c -q -f "$tmp"; then
    rm -f "$tmp"
    log "WARNING: generated sudoers file failed validation; not installing"
    return 0
  fi

  install -m 440 -o root -g root "$tmp" "$SUDOERS_FILE"
  rm -f "$tmp"
  note_change "granted ${CUTIE_USER} passwordless sudo via ${SUDOERS_FILE}"
}

configure_login_shell() {
  local current
  current="$(getent passwd "$CUTIE_USER" 2>/dev/null | cut -d: -f7)"

  case "$current" in
  "")
    log "WARNING: user ${CUTIE_USER} not found; skipping login shell"
    ;;
  */nologin | */false)
    usermod --shell "$LOGIN_SHELL" "$CUTIE_USER"
    note_change "set ${CUTIE_USER} login shell to ${LOGIN_SHELL} (was ${current})"
    ;;
  *)
    # Anything else is a deliberate choice and is left alone.
    ;;
  esac
}

# ---------------------------------------------------------------------------
# Dependencies, including the three native modules that compile from source
# (i2c-bus, usocket, deasync).
#
# Running this at image-build time means a card boots ready instead of spending
# 15-30 minutes compiling on first use. It is safe under sdm's qemu emulation
# despite `uname -m` reporting armv7l there, because node-gyp does not consult
# uname: create-config-gypi.js takes target_arch from `process.arch` and falls
# back to `process.config` for arm_version/arm_fpu. Both come from the running
# Node binary, which install_node has already made the armv6l build. None of
# the four binding.gyp files override march/mfpu either.
# ---------------------------------------------------------------------------

install_cutie_deps() {
  local lock="${CUTIE_DIR}/package-lock.json"
  local stamp="${CUTIE_DIR}/node_modules/.cutie-lock-hash"

  if [ ! -f "$lock" ]; then
    log "WARNING: ${lock} not found; skipping dependency install"
    return 0
  fi

  local want have
  want="$(sha256sum "$lock" | cut -d' ' -f1)"
  have="$(cat "$stamp" 2>/dev/null || true)"

  # Keyed on the lockfile so a dependency change forces a rebuild, while an
  # ordinary re-converge stays a no-op rather than a 20-minute recompile.
  if [ -d "${CUTIE_DIR}/node_modules" ] && [ "$want" = "$have" ]; then
    return 0
  fi

  log "installing cutie dependencies - native modules compile, this is slow"

  # --omit=dev is required, not an optimisation. esbuild's linux-arm prebuild is
  # built for ARMv7 and dies with SIGILL on ARMv6 during its own postinstall,
  # and npm then removes node_modules - discarding every native module already
  # compiled. esbuild arrives via tsx, which a Pi never needs.
  #
  # npm de-escalates to the owner of the working directory when run as root, so
  # this produces pi-owned files; the chown covers npm versions that do not.
  (cd "$CUTIE_DIR" && npm ci --omit=dev)
  chown -R "${CUTIE_USER}:${CUTIE_USER}" "${CUTIE_DIR}/node_modules"

  printf '%s' "$want" >"$stamp"
  chown "${CUTIE_USER}:${CUTIE_USER}" "$stamp"
  note_change "installed cutie dependencies"
}

# ---------------------------------------------------------------------------
# Scrub credentials sdm leaves in its own build log.
#
# sdm --redact cleans the plugin-argument logging, but not the line where sdm
# echoes its own invocation at the start of a run - so the wifi PSK and the pi
# password still ship on the card in plaintext. /etc/sdm is mode 700, so this
# only matters if the card is read on another machine, which is exactly the
# case worth caring about for a wifi key.
#
# Done here rather than relying on sdm because this also repairs cards burned
# from earlier images, and it runs late enough that nothing re-adds the line.
# ---------------------------------------------------------------------------

scrub_sdm_history() {
  local history="/etc/sdm/history"
  [ -f "$history" ] || return 0

  # Compared by content rather than by pattern: a guard looking for
  # `password=<something>` also matches `password=<redacted>`, so it would
  # re-run the substitution and report a change on every single converge.
  local before
  before="$(cat "$history")"

  sed -i -E 's/((wifi)?password)=[^|"[:space:]]*/\1=<redacted>/g' "$history"

  if [ "$before" = "$(cat "$history")" ]; then
    return 0
  fi
  note_change "redacted credentials from ${history}"
}

# ---------------------------------------------------------------------------
# The cutie service and its journald namespace.
# ---------------------------------------------------------------------------

install_unit_file() {
  local src="$1" dest="$2"
  if [ ! -f "$src" ]; then
    return 1
  fi
  if cmp -s "$src" "$dest"; then
    return 1
  fi
  install -m 644 -o root -g root "$src" "$dest"
  note_change "installed ${dest}"
  return 0
}

install_cutie_service() {
  local conf="${CUTIE_DIR}/config"
  if [ ! -f "${conf}/cutie.service" ]; then
    log "WARNING: ${conf}/cutie.service not found; skipping service install"
    log "         run this script again after the cutie checkout is in place"
    return 0
  fi

  install -d -o "$CUTIE_USER" -g "$CUTIE_USER" "${CUTIE_HOME}/logs"

  local touched="no"
  if install_unit_file "${conf}/cutie.service" /etc/systemd/system/cutie.service; then
    touched="yes"
  fi
  if install_unit_file "${conf}/cutie.journald.conf" /etc/systemd/journald@cutie.conf; then
    touched="yes"
  fi

  if [ "$touched" = "no" ] && systemctl is-enabled cutie >/dev/null 2>&1; then
    return 0
  fi

  # daemon-reload needs a running systemd to talk to. Inside sdm's nspawn there
  # is none, and an unguarded call would fail the whole script. `enable` is
  # offline-capable - it only writes symlinks - so it runs either way.
  if pgrep systemd >/dev/null 2>&1; then
    systemctl daemon-reload
  fi
  systemctl enable cutie >/dev/null
  note_change "cutie.service enabled"
}

# ---------------------------------------------------------------------------

# Both architectures are logged deliberately: under sdm's emulation they differ,
# and seeing that difference is what makes a wrong-arch install obvious.
log "phase=${phase} target=$(target_arch) uname=$(uname -m) host=$(hostname)"

configure_boot_config_checked
configure_i2c_dev
configure_swap
install_packages
install_node
configure_groups
configure_login_shell
configure_sudoers
install_cutie_deps
install_cutie_service
scrub_sdm_history

if [ "$changed" -eq 0 ]; then
  log "already converged; nothing to do"
else
  log "${changed} change(s) applied"
fi

# Named rather than blanket, so a run that changed nothing needing a reboot does
# not train the reader to ignore the warning.
if [ -n "$reboot_reasons" ] && [ "$live" = "yes" ]; then
  log "REBOOT REQUIRED for:${reboot_reasons}"
fi
