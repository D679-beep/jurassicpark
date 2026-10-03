// Seeded RNG (mulberry32). The generator state is a uint32 stored in
// GameState.rng; every function here is pure and returns the next state.

/** Normalise any integer seed to a uint32 generator state. */
export function seedToRngState(seed: number): number {
  return seed >>> 0;
}

/** Returns a float in [0, 1) and the next generator state. */
export function nextRandom(state: number): [value: number, next: number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Returns an integer in [min, max] (inclusive) and the next generator state. */
export function rollInt(state: number, min: number, max: number): [value: number, next: number] {
  const [v, next] = nextRandom(state);
  return [min + Math.floor(v * (max - min + 1)), next];
}
