export function cleanVersion(value: string): number[] {
  return value.replace(/^v/iu, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/** Compares the installed build only with the latest published release.
 * There is deliberately no sequential-update rule: 0.3.11 can install
 * 0.3.13 directly when that is the latest stable release.
 */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const left = cleanVersion(candidate);
  const right = cleanVersion(installed);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}
