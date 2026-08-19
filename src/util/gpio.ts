import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const GPIO_ROOT = "/sys/class/gpio";
const BCM_CHIP_LABEL = "pinctrl-bcm2835";

// Read the sysfs line number that BCM GPIO 0 maps to.
//
// Before kernel 6.6 the sysfs GPIO numbers happened to equal the BCM numbers,
// so libraries hardcoded them. They no longer match: on current kernels the
// BCM2835 controller's lines start at 512, so BCM 17 becomes sysfs 529 and
// exporting 17 fails outright. Anything handing BCM numbers to a sysfs-based
// library - onoff among them - has to add this first.
//
// Reading the base rather than assuming an offset keeps it correct across
// kernel versions and on boards whose base differs. Returns undefined when
// there is nothing to read, so the caller can say so under its own topic; this
// module is not a Configurable and has no topic to log under.
export async function readGpioBase(): Promise<number | undefined> {
  try {
    const entries = await readdir(GPIO_ROOT);
    const chips = entries.filter((entry) => entry.startsWith("gpiochip"));

    for (const chip of chips) {
      const label = (
        await readFile(join(GPIO_ROOT, chip, "label"), "utf8")
      ).trim();
      if (label !== BCM_CHIP_LABEL) continue;
      const base = Number(
        (await readFile(join(GPIO_ROOT, chip, "base"), "utf8")).trim(),
      );
      if (Number.isFinite(base)) return base;
    }

    // No labelled BCM controller. Fall back to the single chip if there is
    // exactly one, since that is unambiguous.
    if (chips.length === 1) {
      const base = Number(
        (await readFile(join(GPIO_ROOT, chips[0], "base"), "utf8")).trim(),
      );
      if (Number.isFinite(base)) return base;
    }
  } catch {
    // sysfs GPIO absent entirely.
  }

  return undefined;
}
