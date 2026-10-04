// Particle pool and small fx drawing primitives (visual-style.md 6.5).
// Owner: WS4 (FX, Domains, animation). Used by fx.ts and domains.ts only.
//
// Budget (6.5): hard cap 192 live particles at any resolution, ambient
// sources share at most 64. The pool lives in fx (one per renderer, no
// module state). Domain ambience (wind, embers, motes; layer 11) is drawn
// procedurally by domains.ts from `now` and hashes, so it needs no storage;
// it is counted against the same budget: domains draws at most
// DOMAIN_AMBIENT_SHARE of them and the fx pool is capped at
// PARTICLE_CAP - DOMAIN_AMBIENT_SHARE (ambient: AMBIENT_CAP - share), so the
// whole board never shows more than 192 particles / 64 ambient ones.
//
// Storage is struct-of-arrays (typed arrays, preallocated). Positions are in
// tile units (they survive a resize), velocities in tiles/s, ages in ms. A
// particle spawned with a delay starts at a negative age and is neither
// moved nor drawn until its age reaches 0, so a burst can be scheduled for a
// step's impact moment at step start. Ages advance with the frame dt, so the
// pool pauses with the frame loop (hidden tab: no frames, no work).
import { hash } from './noise';

export const PARTICLE_CAP = 192;
export const AMBIENT_CAP = 64;
/** Ambient particles reserved for the procedural Domain ambience (domains.ts). */
export const DOMAIN_AMBIENT_SHARE = 40;
/** The fx pool's own caps (6.5 budget minus the Domain share). */
export const FX_POOL_CAP = PARTICLE_CAP - DOMAIN_AMBIENT_SHARE;
export const FX_AMBIENT_CAP = AMBIENT_CAP - DOMAIN_AMBIENT_SHARE;
/** Reduced motion (6.5): 40 live particles at most. */
export const REDUCED_CAP = 40;

// --- flags ---------------------------------------------------------------------

/** Counts against the ambient cap; recycled first when the pool is full. */
export const P_AMBIENT = 1;
/** Drawn in the additive (`lighter`) batch. */
export const P_ADD = 2;
/** Rotated rectangle (splinters, shards) instead of a disc. */
export const P_RECT = 4;
/** Short streak along the velocity (sparks). */
export const P_STREAK = 8;
/** Fade with 1 - easeOutQuad (dust) instead of the default late fade. */
export const P_FADE_FAST = 16;
/** Fade in over the first 20 % of life (smoke, motes). */
export const P_FADE_IN = 32;
/** Size grows to 2.2x over life (dust puffs spreading). */
export const P_GROW = 64;
/** Size shrinks to 0.3x over life (flame tongues tapering as they rise). */
export const P_SHRINK = 128;

// --- colour ramps ------------------------------------------------------------------

const RAMP_STEPS = 8;

function parseHex(c: string): [number, number, number] {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Precomputed colour strings through the hex stops, so drawing never formats strings. */
function ramp(...stops: string[]): readonly string[] {
  const cs = stops.map(parseHex);
  const out: string[] = [];
  for (let i = 0; i < RAMP_STEPS; i++) {
    const t = (i / (RAMP_STEPS - 1)) * (cs.length - 1);
    const k = Math.min(cs.length - 2, Math.floor(t));
    const a = cs[Math.max(0, k)]!;
    const b = cs[Math.min(cs.length - 1, k + 1)]!;
    const u = cs.length === 1 ? 0 : t - k;
    const r = Math.round(a[0] + (b[0] - a[0]) * u);
    const g = Math.round(a[1] + (b[1] - a[1]) * u);
    const bl = Math.round(a[2] + (b[2] - a[2]) * u);
    out.push(`rgb(${r},${g},${bl})`);
  }
  return out;
}

/** Colour ramps by index (stored per particle as a Uint8). */
export const RAMP = {
  dust: 0,
  sparkRebel: 1,
  sparkLoyal: 2,
  clash: 3,
  flame: 4,
  ember: 5,
  ash: 6,
  wood: 7,
  woodDark: 8,
  shard: 9,
  heal: 10,
  teal: 11,
  seal: 12,
  smoke: 13,
  tempest: 14,
  pyre: 15,
  bulwark: 16,
  sanctuary: 17,
  silence: 18,
  gold: 19,
  grey: 20,
  ward: 21,
  woodLight: 22,
} as const;

export const RAMPS: readonly (readonly string[])[] = [
  ramp('#968c82'), // dust rgba(150,140,130) (alpha per particle)
  ramp('#bff0ff', '#6fd3ff'), // rebel accent sparks
  ramp('#fffbe6', '#fff1b8'), // loyalist accent sparks
  ramp('#fff0c8', '#ffd08a'), // duel clash
  ramp('#ff5a1f', '#ffb347', '#ffe2a0'), // flame (6.3 pyre hit)
  ramp('#ff9a4a', '#5a2a1a'), // death embers
  ramp('#6a6570'), // ash flakes
  ramp('#5e3d22'), // DOOR.wood
  ramp('#3a2312'), // DOOR.woodDark
  ramp('#c8f4ff', '#6a7cff'), // anchor shards
  ramp('#cfe9a0', '#fff6c8'), // heal motes
  ramp('#7fe0d0', '#e8c872'), // escape swirl (teal -> gold)
  ramp('#bff4ff', '#8cdcff'), // seal link shards
  ramp('#5a5560', '#2a282e'), // smoke
  ramp('#dbe8ff', '#8fd8ff'), // tempest
  ramp('#ffb347', '#ff5a1f'), // pyre
  ramp('#f0d7a0', '#ecd9a8'), // bulwark
  ramp('#fff6c8', '#fff0b0'), // sanctuary
  ramp('#b9a6e0', '#8a76b8'), // silence
  ramp('#ffe7a0', '#c9a24a'), // gold
  ramp('#c8c8cc', '#77777c'), // grey (drained)
  ramp('#c8f4ff', '#78aaff'), // ward light
  ramp('#9a6a3c'), // lit splinter faces
];

export function rampColor(r: number, t: number): string {
  const steps = RAMPS[r] ?? RAMPS[0]!;
  const i = t <= 0 ? 0 : t >= 1 ? RAMP_STEPS - 1 : Math.floor(t * RAMP_STEPS);
  return steps[Math.min(RAMP_STEPS - 1, i)]!;
}

// --- the pool ------------------------------------------------------------------------

export interface PoolLimits {
  cap: number;
  ambientCap: number;
}

export class ParticlePool {
  readonly x = new Float32Array(FX_POOL_CAP);
  readonly y = new Float32Array(FX_POOL_CAP);
  readonly vx = new Float32Array(FX_POOL_CAP);
  readonly vy = new Float32Array(FX_POOL_CAP);
  /** Vertical acceleration (tiles/s^2, + = down). */
  readonly ay = new Float32Array(FX_POOL_CAP);
  /** Velocity damping per second (0 = none). */
  readonly drag = new Float32Array(FX_POOL_CAP);
  /** ms; negative while delayed. */
  readonly age = new Float32Array(FX_POOL_CAP);
  readonly life = new Float32Array(FX_POOL_CAP);
  /** Radius (disc), half length (rect/streak), tiles. */
  readonly size = new Float32Array(FX_POOL_CAP);
  readonly rot = new Float32Array(FX_POOL_CAP);
  readonly vrot = new Float32Array(FX_POOL_CAP);
  readonly alpha = new Float32Array(FX_POOL_CAP);
  /** Spawn order, for "recycle the oldest". */
  readonly serial = new Float64Array(FX_POOL_CAP);
  readonly ramp = new Uint8Array(FX_POOL_CAP);
  readonly flags = new Uint8Array(FX_POOL_CAP);
  count = 0;
  private nextSerial = 0;
  /** Effective caps (reduced motion lowers them); set by the owner each frame / burst. */
  readonly limits: PoolLimits = { cap: FX_POOL_CAP, ambientCap: FX_AMBIENT_CAP };

  clear(): void {
    this.count = 0;
  }

  ambientCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.flags[i]! & P_AMBIENT) n++;
    return n;
  }

  /** Index of the oldest particle matching `ambientOnly` (or any), -1 if none. */
  private oldest(ambientOnly: boolean): number {
    let best = -1;
    let bs = Infinity;
    for (let i = 0; i < this.count; i++) {
      if (ambientOnly && !(this.flags[i]! & P_AMBIENT)) continue;
      if (this.serial[i]! < bs) {
        bs = this.serial[i]!;
        best = i;
      }
    }
    return best;
  }

  /**
   * Adds a particle and returns its slot, or -1 when an ambient particle
   * does not fit. Bursts are never dropped: when the pool is full they
   * recycle the oldest ambient particle, else the oldest particle.
   */
  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    rampIdx: number,
    flags: number,
    delay = 0,
    ay = 0,
    drag = 0,
    alpha = 1,
    rot = 0,
    vrot = 0,
  ): number {
    const ambient = (flags & P_AMBIENT) !== 0;
    const cap = Math.min(FX_POOL_CAP, this.limits.cap);
    let i: number;
    if (ambient) {
      if (this.ambientCount() >= this.limits.ambientCap) return -1;
      if (this.count >= cap) {
        i = this.oldest(true);
        if (i < 0) return -1;
      } else i = this.count++;
    } else if (this.count >= cap) {
      i = this.oldest(true);
      if (i < 0) i = this.oldest(false);
      if (i < 0) return -1;
    } else i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.ay[i] = ay;
    this.drag[i] = drag;
    this.age[i] = -Math.max(0, delay);
    this.life[i] = Math.max(1, life);
    this.size[i] = size;
    this.rot[i] = rot;
    this.vrot[i] = vrot;
    this.alpha[i] = alpha;
    this.ramp[i] = rampIdx;
    this.flags[i] = flags;
    this.serial[i] = this.nextSerial++;
    return i;
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.ay[i] = this.ay[last]!;
    this.drag[i] = this.drag[last]!;
    this.age[i] = this.age[last]!;
    this.life[i] = this.life[last]!;
    this.size[i] = this.size[last]!;
    this.rot[i] = this.rot[last]!;
    this.vrot[i] = this.vrot[last]!;
    this.alpha[i] = this.alpha[last]!;
    this.serial[i] = this.serial[last]!;
    this.ramp[i] = this.ramp[last]!;
    this.flags[i] = this.flags[last]!;
  }

  /** Advances every particle by `dt` ms and drops the expired ones. */
  update(dt: number): void {
    const s = dt / 1000;
    for (let i = this.count - 1; i >= 0; i--) {
      const prevAge = this.age[i]!;
      const age = prevAge + dt;
      this.age[i] = age;
      if (age >= this.life[i]!) {
        this.kill(i);
        continue;
      }
      if (age <= 0) continue;
      // Only the part of dt after the delay moves the particle.
      const st = prevAge < 0 ? age / 1000 : s;
      const d = this.drag[i]!;
      if (d > 0) {
        const k = Math.max(0, 1 - d * st);
        this.vx[i] = this.vx[i]! * k;
        this.vy[i] = this.vy[i]! * k;
      }
      this.vy[i] = this.vy[i]! + this.ay[i]! * st;
      this.x[i] = this.x[i]! + this.vx[i]! * st;
      this.y[i] = this.y[i]! + this.vy[i]! * st;
      this.rot[i] = this.rot[i]! + this.vrot[i]! * st;
    }
  }

  /** Draws the live particles: the normal batch, then the additive batch. */
  draw(ctx: CanvasRenderingContext2D, T: number): void {
    if (this.count === 0) return;
    this.drawBatch(ctx, T, false);
    ctx.globalCompositeOperation = 'lighter';
    this.drawBatch(ctx, T, true);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private drawBatch(ctx: CanvasRenderingContext2D, T: number, additive: boolean): void {
    let style = '';
    for (let i = 0; i < this.count; i++) {
      const fl = this.flags[i]!;
      if (((fl & P_ADD) !== 0) !== additive) continue;
      const age = this.age[i]!;
      if (age < 0) continue;
      const t = age / this.life[i]!;
      let a = this.alpha[i]!;
      if (fl & P_FADE_FAST) a *= (1 - t) * (1 - t);
      else a *= 1 - t * t;
      if (fl & P_FADE_IN && t < 0.2) a *= t / 0.2;
      if (a <= 0.01) continue;
      const c = rampColor(this.ramp[i]!, t);
      ctx.globalAlpha = a > 1 ? 1 : a;
      const px = this.x[i]! * T;
      const py = this.y[i]! * T;
      const sz = Math.max(0.5, this.size[i]! * T * (fl & P_GROW ? 1 + 1.2 * t : fl & P_SHRINK ? 1 - 0.7 * t : 1));
      if (fl & P_STREAK) {
        if (c !== style) {
          ctx.strokeStyle = c;
          style = c;
        }
        const vx = this.vx[i]!;
        const vy = this.vy[i]!;
        const v = Math.hypot(vx, vy) || 1;
        ctx.lineWidth = Math.max(1.5, sz * 0.7);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - (vx / v) * sz * 3, py - (vy / v) * sz * 3);
        ctx.stroke();
        continue;
      }
      if (c !== style) {
        ctx.fillStyle = c;
        style = c;
      }
      if (fl & P_RECT) {
        // Rotated rectangle: half length sz, half width sz * 0.35.
        const r = this.rot[i]!;
        const cs = Math.cos(r);
        const sn = Math.sin(r);
        const hx = cs * sz;
        const hy = sn * sz;
        const wx = -sn * sz * 0.35;
        const wy = cs * sz * 0.35;
        ctx.beginPath();
        ctx.moveTo(px - hx - wx, py - hy - wy);
        ctx.lineTo(px + hx - wx, py + hy - wy);
        ctx.lineTo(px + hx + wx, py + hy + wy);
        ctx.lineTo(px - hx + wx, py - hy + wy);
        ctx.closePath();
        ctx.fill();
      } else if (sz < 1.6) {
        ctx.fillRect(px - sz, py - sz, sz * 2, sz * 2);
      } else {
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// --- drawing primitives shared by fx.ts and domains.ts --------------------------------

/**
 * A cache of soft radial glow sprites (one per colour), drawn scaled with
 * `lighter` for flashes and halos above the darkness. Owned per pass
 * instance (no module state); dropped on reset().
 */
export class GlowSprites {
  private readonly sprites = new Map<string, HTMLCanvasElement | OffscreenCanvas>();

  get(rgb: readonly [number, number, number]): HTMLCanvasElement | OffscreenCanvas | null {
    const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    let c = this.sprites.get(key);
    if (c) return c;
    const made = makeCanvas(64, 64);
    if (!made) return null;
    const g = made.getContext('2d') as CanvasRenderingContext2D | null;
    if (!g) return null;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${key},1)`);
    grad.addColorStop(0.35, `rgba(${key},0.45)`);
    grad.addColorStop(1, `rgba(${key},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    c = made;
    this.sprites.set(key, c);
    return c;
  }

  /** Additive glow of radius `r` px at (x, y), alpha `a`. Caller sets `lighter`. */
  draw(ctx: CanvasRenderingContext2D, rgb: readonly [number, number, number], x: number, y: number, r: number, a: number): void {
    if (a <= 0.01 || r <= 0) return;
    const s = this.get(rgb);
    if (!s) return;
    ctx.globalAlpha = a > 1 ? 1 : a;
    ctx.drawImage(s as CanvasImageSource, x - r, y - r, r * 2, r * 2);
  }

  clear(): void {
    this.sprites.clear();
  }
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  return null;
}

/** Scratch storage for bolt polylines (no allocation per frame). */
const BOLT_MAX = 16;

export class BoltPath {
  readonly xs = new Float32Array(BOLT_MAX + 1);
  readonly ys = new Float32Array(BOLT_MAX + 1);
  n = 0;

  /** Jagged polyline from (x0,y0) to (x1,y1) in px, `segs` segments, perpendicular jitter `jit` px, deterministic by seed. */
  build(x0: number, y0: number, x1: number, y1: number, segs: number, jit: number, seed: number): void {
    const n = Math.max(1, Math.min(BOLT_MAX, segs));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : (hash(i, seed | 0, 77) * 2 - 1) * jit;
      this.xs[i] = x0 + dx * t + nx * j;
      this.ys[i] = y0 + dy * t + ny * j;
    }
    this.n = n;
  }

  stroke(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.moveTo(this.xs[0]!, this.ys[0]!);
    for (let i = 1; i <= this.n; i++) ctx.lineTo(this.xs[i]!, this.ys[i]!);
    ctx.stroke();
  }
}

/**
 * Lightning: a glow stroke `#8fd8ff` T/6 at 0.5 plus a white core
 * max(2, T/16) (6.3 tempest hit). Caller sets composite; alpha scales both.
 */
export function drawLightning(ctx: CanvasRenderingContext2D, bolt: BoltPath, T: number, alpha: number, glow = '#8fd8ff', core = '#ffffff'): void {
  if (alpha <= 0.01) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = glow;
  ctx.globalAlpha = 0.5 * alpha;
  ctx.lineWidth = Math.max(3, T / 6);
  bolt.stroke(ctx);
  ctx.strokeStyle = core;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(2, T / 16);
  bolt.stroke(ctx);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}
