// Deterministic hashing and value noise (visual-style.md 9.1).
// Owner: WS0 (Foundation). Pure; no Math.random anywhere in the renderer so
// the board looks the same on every load.

/** Stable hash of an integer tile coordinate and salt to [0, 1). Same function the old renderer used. */
export function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Stable hash of a string (unit ids, object ids) to [0, 1). FNV-1a. */
export function hashString(s: string, salt = 0): number {
  let h = (2166136261 ^ Math.imul(salt | 0, 16777619)) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 1D value noise in [-1, 1], smooth, period-free; integer lattice at whole t. */
export function valueNoise1D(t: number, seed = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(i, 0, seed) * 2 - 1;
  const b = hash(i + 1, 0, seed) * 2 - 1;
  return a + (b - a) * smooth(f);
}

/** 2D value noise in [-1, 1], bilinear with smoothstep. */
export function valueNoise2D(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash(ix, iy, seed) * 2 - 1;
  const b = hash(ix + 1, iy, seed) * 2 - 1;
  const c = hash(ix, iy + 1, seed) * 2 - 1;
  const d = hash(ix + 1, iy + 1, seed) * 2 - 1;
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}
