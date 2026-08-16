// Every hardware-driving module reaches its native package through here.
// Those packages are optionalDependencies, so a machine with no build
// toolchain installs cutie fine and only trips when a config actually asks
// for that hardware -- at which point the failure needs to name the package
// rather than surface a bare module-resolution error.
export async function importOptional<T>(
  packageName: string,
  requiredBy: string,
): Promise<T> {
  try {
    return (await import(packageName)) as T;
  } catch (error) {
    throw new Error(
      `${requiredBy} needs the optional "${packageName}" package, which is not installed or failed to build. Install build tools and re-run npm install. (${error})`,
    );
  }
}
