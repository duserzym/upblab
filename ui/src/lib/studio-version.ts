/** Numeric dotted versions only. Unknown formats do not block opening a run. */
export function compareStudioVersions(installed?: string | null, saved?: string | null): -1 | 0 | 1 | null {
  const parse = (version?: string | null) => {
    const value = version?.trim().replace(/^v/, '');
    return value && /^\d+(?:\.\d+)*$/.test(value) ? value.split('.').map(BigInt) : null;
  };
  const left = parse(installed), right = parse(saved);
  if (!left || !right) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = left[i] ?? 0n, b = right[i] ?? 0n;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}
