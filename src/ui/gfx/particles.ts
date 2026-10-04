// Particle pool (visual-style.md 6.5): one preallocated struct-of-arrays
// pool, hard cap 192 live particles (40 in reduced motion), ambient sources
// share at most 64, flat rects/circles, additive ones in one `lighter` batch.
// Owner: WS4 (FX, Domains, animation). WS0 STUB: the pre-overhaul board had
// no particles. The skeleton below fixes the storage layout only; WS4 owns
// the API (spawn, update, draw) and may reshape it freely, since only fx.ts
// and domains.ts use it.

export const PARTICLE_CAP = 192;
export const AMBIENT_CAP = 64;

export class ParticlePool {
  readonly x = new Float32Array(PARTICLE_CAP);
  readonly y = new Float32Array(PARTICLE_CAP);
  readonly vx = new Float32Array(PARTICLE_CAP);
  readonly vy = new Float32Array(PARTICLE_CAP);
  readonly born = new Float64Array(PARTICLE_CAP);
  readonly life = new Float32Array(PARTICLE_CAP);
  readonly size = new Float32Array(PARTICLE_CAP);
  /** Index into a colour table owned by the caller. */
  readonly color = new Uint16Array(PARTICLE_CAP);
  /** Bit flags (ambient, additive, ...), defined by the caller. */
  readonly flags = new Uint8Array(PARTICLE_CAP);
  count = 0;

  clear(): void {
    this.count = 0;
  }
}
