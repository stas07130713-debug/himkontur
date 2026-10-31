function versionParts(value) {
  return String(value ?? '').replace(/^v/iu, '').split(/[.+-]/u).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewerRelease(candidate, installed) {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  for (let index = 0; index < 3; index += 1) {
    if ((next[index] ?? 0) > (current[index] ?? 0)) return true;
    if ((next[index] ?? 0) < (current[index] ?? 0)) return false;
  }
  return false;
}

export function parseLatestYml(value) {
  const text = String(value ?? '');
  const version = text.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/imu)?.[1] ?? '';
  const path = text.match(/^path:\s*['"]?([^'"\r\n]+?)['"]?\s*$/imu)?.[1] ?? '';
  const sha512 = text.match(/^sha512:\s*['"]?([^'"\s]+)['"]?\s*$/imu)?.[1] ?? '';
  if (version === '' || path === '') return null;
  return { version, path, sha512 };
}
