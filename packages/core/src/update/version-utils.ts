/**
 * Simple semver utilities — no external deps.
 */

export function parseVersion(v: string): [number, number, number] {
  // Strip leading 'v' and any pre-release suffix
  const cleaned = v.replace(/^v/, '').split('-')[0] ?? v;
  const parts = cleaned.split('.');
  const major = parseInt(parts[0] ?? '0', 10) || 0;
  const minor = parseInt(parts[1] ?? '0', 10) || 0;
  const patch = parseInt(parts[2] ?? '0', 10) || 0;
  return [major, minor, patch];
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [aMaj, aMin, aPat] = parseVersion(a);
  const [bMaj, bMin, bPat] = parseVersion(b);

  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  if (aPat !== bPat) return aPat < bPat ? -1 : 1;
  return 0;
}

export function classifyUpdate(from: string, to: string): 'patch' | 'minor' | 'major' | 'none' {
  const [fMaj, fMin] = parseVersion(from);
  const [tMaj, tMin] = parseVersion(to);

  if (compareVersions(from, to) === 0) return 'none';
  if (tMaj !== fMaj) return 'major';
  if (tMin !== fMin) return 'minor';
  return 'patch';
}
