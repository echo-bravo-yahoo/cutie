#!/usr/bin/env bash
#
# Verify a customized cutie image before burning it.
#
#   provisioner/verify-image.sh provisioner/cache/<host>.<base>.img
#
# Every check reads the image file directly - the ext4 root via debugfs's
# `?offset=` support, the FAT boot partition by byte range. Nothing is mounted
# and nothing needs root, which matters because `sudo` is not always available
# and a burn is not reversible.
#
# Each finding here corresponds to a defect that reached real hardware at least
# once. A headless image disables piwiz, so everything piwiz would normally
# complete on first boot has to be verified rather than assumed.

set -euo pipefail

IMAGE="${1:?usage: verify-image.sh <image.img>}"
[ -f "$IMAGE" ] || {
  echo "no such image: $IMAGE" >&2
  exit 1
}

DEBUGFS="${DEBUGFS:-/usr/sbin/debugfs}"
for tool in "$DEBUGFS" readelf file; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "required tool not found: $tool (e2fsprogs / binutils)" >&2
    exit 1
  }
done

# Refuse to read an image that is still being written. A half-customized image
# reads as a pristine base image - correct-looking filesystem, none of the
# customization - so every check fails for a reason that has nothing to do with
# the build. The bracket keeps these patterns from matching this script's own
# command line.
if pgrep -f "[s]dm --customize" >/dev/null 2>&1 ||
  pgrep -f "[p]rovision\.mjs" >/dev/null 2>&1; then
  echo "an image build is running; results would be meaningless. Wait for it." >&2
  exit 1
fi

pass=0
fail=0

ok() {
  printf '  ok    %s\n' "$*"
  pass=$((pass + 1))
}
bad() {
  printf '  FAIL  %s\n' "$*"
  fail=$((fail + 1))
}

# Partition geometry, straight from the MBR via `file`.
geometry="$(file "$IMAGE")"
root_start="$(printf '%s' "$geometry" | sed -n 's/.*partition 2 :.*startsector \([0-9]*\).*/\1/p')"
boot_start="$(printf '%s' "$geometry" | sed -n 's/.*partition 1 :.*startsector \([0-9]*\).*/\1/p')"
boot_count="$(printf '%s' "$geometry" | sed -n 's/.*partition 1 :.*startsector [0-9]*, \([0-9]*\) sectors.*/\1/p')"

[ -n "$root_start" ] || {
  echo "could not find a second partition; is this a Raspberry Pi image?" >&2
  exit 1
}

ROOT="${IMAGE}?offset=$((root_start * 512))"

# -c (catastrophic) skips the allocation bitmaps, which a freshly shrunk image
# can fail a checksum on while remaining perfectly readable.
rootcat() { "$DEBUGFS" -c -R "cat $1" "$ROOT" 2>/dev/null; }
rootls() { "$DEBUGFS" -c -R "ls -l $1" "$ROOT" 2>/dev/null; }

bootgrep() {
  tail -c "+$((boot_start * 512 + 1))" "$IMAGE" |
    head -c "$((boot_count * 512))" | grep -a -c "$1" || true
}

echo "verifying $(basename "$IMAGE")"
echo

echo "identity (piwiz would normally do these; a headless image must not rely on it)"
# `|| true` on every substitution: pipefail turns a debugfs hiccup into a failed
# assignment, which errexit would turn into a silent exit mid-report.
shell="$(rootcat /etc/passwd | sed -n 's/^pi:[^:]*:[^:]*:[^:]*:[^:]*:[^:]*:\(.*\)$/\1/p' || true)"
case "$shell" in
"" | */nologin | */false) bad "pi login shell is '${shell:-missing}' - SSH will connect but run nothing" ;;
*) ok "pi login shell is $shell" ;;
esac

if rootls /etc/sudoers.d | grep -q nopasswd; then
  ok "passwordless sudo present"
else
  bad "no sudoers NOPASSWD drop-in - remote administration will be blocked"
fi

if rootls /home/pi/.ssh | grep -qE '100[0-7]00 .* authorized_keys'; then
  ok "authorized_keys is a regular file"
else
  bad "authorized_keys missing or not a regular file - check copyfile's to= is a DIRECTORY"
fi

echo
echo "hardware"
if rootls /etc/modules-load.d | grep -q i2c; then
  ok "i2c-dev module configured"
else
  bad "no i2c-dev module conf - /dev/i2c-* will not exist even with dtparam set"
fi

if [ "$(bootgrep '^dtparam=i2c_arm=on')" -gt 0 ]; then
  ok "i2c enabled in config.txt"
else
  bad "i2c not enabled in config.txt"
fi

if [ "$(bootgrep '^dtparam=spi=on')" -gt 0 ]; then
  ok "spi enabled in config.txt"
else
  bad "spi not enabled in config.txt"
fi

if rootcat /etc/rpi/swap.conf.d/99-cutie-swap.conf | grep -qE '^Mechanism=swapfile'; then
  ok "swap mechanism is swapfile"
else
  bad "swap mechanism not set - rpi-swap defaults to zram+file, giving RAM-sized swap"
fi

echo
echo "runtime"
node_dir="$(rootls /usr/local | sed -n 's/.*[0-9] \(node-v[0-9.]*-linux-[a-z0-9]*\)$/\1/p' | head -1 || true)"
case "$node_dir" in
"") bad "no Node found under /usr/local" ;;
*armv7l*) bad "$node_dir - ARMv7 will not run on a Pi Zero W" ;;
*) ok "$node_dir" ;;
esac

if rootls /etc/systemd/system/multi-user.target.wants | grep -q cutie.service; then
  ok "cutie.service enabled"
else
  bad "cutie.service not enabled"
fi

if rootcat /home/pi/workspace/cutie/config/cutie.conf.yaml | grep -q '"connectionName"'; then
  ok "cutie config has a configProvider connection"
else
  bad "cutie config lacks connectionName - startup dies on 'connection \"undefined\"'"
fi

# The compiled objects are the one thing worth checking at instruction level:
# a wrong-architecture build reports the right Node version quite happily.
natives=0
armv6=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# module:binary pairs, since the .node name rarely matches the package name.
for pair in i2c-bus:i2c pigpio:pigpio usocket:uwrap rpio:rpio pi-spi:spi_binding; do
  module="${pair%%:*}"
  name="${pair##*:}"
  src="/home/pi/workspace/cutie/node_modules/${module}/build/Release/${name}.node"

  "$DEBUGFS" -c -R "dump $src ${tmp}/${module}.node" "$ROOT" >/dev/null 2>&1 || continue
  [ -s "${tmp}/${module}.node" ] || continue

  natives=$((natives + 1))
  # Tag_CPU_arch is the only thing that distinguishes a usable object from one
  # that reports the right Node version and then dies on an illegal instruction.
  if readelf -A "${tmp}/${module}.node" 2>/dev/null | grep -q 'Tag_CPU_arch: v6'; then
    armv6=$((armv6 + 1))
  else
    printf '        %s is not ARMv6\n' "$module"
  fi
done

if [ "$natives" -eq 0 ]; then
  bad "no compiled native modules - the card will compile for 15-30 min on first boot"
elif [ "$natives" -eq "$armv6" ]; then
  ok "${natives} native modules, all Tag_CPU_arch v6"
else
  bad "${natives} native modules but only ${armv6} are ARMv6"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS - ${pass} checks, safe to burn"
else
  echo "FAIL - ${fail} problem(s), ${pass} ok"
  exit 1
fi
