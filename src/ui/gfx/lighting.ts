// Darkness and glow lightmaps (visual-style.md section 3; layers 5-6), the
// live desaturation pass during an era transition, and levelAt() for the
// unit night shade (3.5).
// Owner: WS2 (Lighting & overlays).
//
// Two low-res canvases at LIGHT_RES px per tile (`dark`, `glow`) are rebuilt
// only when something changes (3.7): a different light list / global light
// (immediately), or flicker / an era transition (at most every REFRESH_MS).
// Each rebuild upscales them once (bilinear) into board-sized caches; every
// frame then blits the caches 1:1, which is several times cheaper than a
// smoothed upscale per frame. Light stamps
// are pre-rendered sprites (one white darkness stamp, one glow stamp per
// colour); no gradient is created per light per frame. The outdoor and
// passable masks are built once per map and softened without ctx.filter.
import { NIGHT } from '../palette';
import { clamp01 } from './ease';
import type { EraLight, GfxFrame, LightingPass, LightSource, MapSites, Rgb } from './types';

/** Low-res lightmap resolution: px per tile, regardless of T (3.1). */
export const LIGHT_RES = 8;
/** Stamp sprite size (px). */
const STAMP = 64;
/** Max vignette alpha at the corners (3.6). */
export const VIGNETTE_MAX = 0.28;
/** Unit night-shade ceiling (3.5); units multiply (1 - levelAt) by this. */
export const MAX_NIGHT_SHADE = 0.38;
/** Glow strength of overhead lights relative to point lights (3.1: 0.16k vs 0.34k). */
const OVERHEAD_GLOW = 0.16 / 0.34;
/**
 * Cold sheen alpha on outdoor tiles at moon 0.36. Spec 3.1 says 0.16; at that
 * strength the open ground went milky grey-blue and the cobbles lost contrast
 * on the screenshots, so it is halved (integrator may retune).
 */
export const MOON_SHEEN = 0.08;
/**
 * Minimum ms between rebuilds driven only by flicker or an era transition
 * (20 Hz). A changed light list (moving or new lights) rebuilds at once.
 */
export const REFRESH_MS = 50;
/** Silence darkener strength in `dark` (6.3). */
const DARKEN_ALPHA = 0.15;

// --- pure helpers (unit-tested) -------------------------------------------------

/**
 * Flicker factor (3.2): `1 + amp * (0.6 sin(2pi 1.7t + 40s) + 0.4 sin(2pi 4.3t + 90s))`,
 * `t` in seconds, `s` the light's seed. Always 1 with reduced motion or amp 0.
 */
export function flickerFactor(amp: number, seed: number, tSec: number, reduced: boolean): number {
  if (reduced || amp <= 0) return 1;
  return 1 + amp * (0.6 * Math.sin(2 * Math.PI * 1.7 * tSec + 40 * seed) + 0.4 * Math.sin(2 * Math.PI * 4.3 * tSec + 90 * seed));
}

/**
 * globalAlpha of the floor-minimum carve (3.1): `destination-out` of the
 * passable mask at this alpha scales the darkness so that an unlit passable
 * tile ends at `floorCap` instead of `darkAlpha`.
 */
export function floorCarveAlpha(darkAlpha: number, floorCap: number): number {
  if (darkAlpha <= 0) return 0;
  return clamp01(1 - floorCap / darkAlpha);
}

/** Darkness alpha left on an unlit tile after the moon and floor carves (no vignette, no lights). */
export function residualDarkness(env: Readonly<EraLight>, outdoor: boolean, passable: boolean): number {
  let d = env.darkAlpha;
  if (outdoor) d *= 1 - clamp01(env.moon);
  if (passable) d *= 1 - floorCarveAlpha(env.darkAlpha, env.floorCap);
  return d;
}

/** Effective light values after flicker and the era lamp factor (3.2, 3.4). */
export function effectiveLight(l: Readonly<LightSource>, env: Readonly<EraLight>, tSec: number, reduced: boolean): { k: number; r: number } {
  const f = flickerFactor(l.flicker, l.seed, tSec, reduced);
  const k = l.intensity * f * (l.lamp ? env.lamp : 1);
  const r = l.radius * (1 + 0.3 * (f - 1));
  return { k, r };
}

/**
 * Light level 0..1 at a tile (3.5):
 * `clamp(1 - darkAlpha + (outdoor ? 0.7 moon : 0) + sum k_i (1 - d_i/r_i) 0.8, 0, 1)`,
 * d = distance from the tile centre to the light. Darkeners subtract.
 * `ks`, `rs`, `xs`, `ys`, `dk` describe `n` lights (typed arrays, reused).
 */
export function lightLevel(
  tx: number,
  ty: number,
  env: Readonly<EraLight>,
  outdoor: boolean,
  n: number,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  rs: ArrayLike<number>,
  ks: ArrayLike<number>,
  dk: ArrayLike<number>,
): number {
  let L = 1 - env.darkAlpha + (outdoor ? 0.7 * env.moon : 0);
  const cx = tx + 0.5;
  const cy = ty + 0.5;
  for (let i = 0; i < n; i++) {
    const r = rs[i]!;
    if (r <= 0) continue;
    const dx = xs[i]! - cx;
    const dy = ys[i]! - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    const fall = 1 - Math.sqrt(d2) / r;
    if (dk[i]) L -= DARKEN_ALPHA * fall;
    else L += ks[i]! * fall * 0.8;
  }
  return L <= 0 ? 0 : L >= 1 ? 1 : L;
}

/** Order-dependent numeric hash step (FNV-like over floats quantised to 1/1024). */
function mix(h: number, v: number): number {
  h ^= Math.round(v * 1024) | 0;
  return Math.imul(h, 16777619) >>> 0;
}

/** Hash of the base light list and the global light: changes iff the lightmaps would. */
export function lightsHash(lights: readonly Readonly<LightSource>[], env: Readonly<EraLight>): number {
  let h = 2166136261;
  h = mix(h, env.darkAlpha);
  h = mix(h, env.floorCap);
  h = mix(h, env.moon);
  h = mix(h, env.lamp);
  h = mix(h, env.tint[0] + env.tint[1] * 256 + env.tint[2] * 65536);
  h = mix(h, lights.length);
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i]!;
    h = mix(h, l.x);
    h = mix(h, l.y);
    h = mix(h, l.radius);
    h = mix(h, l.intensity);
    h = mix(h, l.color[0] + l.color[1] * 256 + l.color[2] * 65536);
    h = mix(h, l.darken ? 1 : l.lamp ? 2 : 3);
  }
  return h;
}

/** True if any light flickers (so the lightmaps change every frame when motion is allowed). */
export function anyFlicker(lights: readonly Readonly<LightSource>[]): boolean {
  for (let i = 0; i < lights.length; i++) if (lights[i]!.flicker > 0 && !lights[i]!.darken) return true;
  return false;
}

// --- canvas helpers ---------------------------------------------------------------

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Radial stamp sprite with alpha stops [(0,a0), (m,am), (end,0)] in colour c. */
function makeStamp(c: Rgb, a0: number, m: number, am: number, end: number): HTMLCanvasElement {
  const s = makeCanvas(STAMP, STAMP);
  const g = s.getContext('2d')!;
  const h = STAMP / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  const col = `${c[0]},${c[1]},${c[2]}`;
  grad.addColorStop(0, `rgba(${col},${a0})`);
  grad.addColorStop(m, `rgba(${col},${am})`);
  grad.addColorStop(end, `rgba(${col},0)`);
  if (end < 1) grad.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, STAMP, STAMP);
  return s;
}

/**
 * Tile mask at LIGHT_RES px/tile, softened by 9 offset copies at 1/9 alpha
 * (+-2 px, no ctx.filter). `on(x, y)` picks the tiles; filled in colour c.
 */
function buildMask(sites: MapSites, c: Rgb, on: (x: number, y: number) => boolean): HTMLCanvasElement {
  const W = sites.w * LIGHT_RES;
  const H = sites.h * LIGHT_RES;
  const hard = makeCanvas(W, H);
  const hg = hard.getContext('2d')!;
  hg.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
  for (let y = 0; y < sites.h; y++) {
    for (let x = 0; x < sites.w; x++) if (on(x, y)) hg.fillRect(x * LIGHT_RES, y * LIGHT_RES, LIGHT_RES, LIGHT_RES);
  }
  const soft = makeCanvas(W, H);
  const sg = soft.getContext('2d')!;
  sg.globalAlpha = 1 / 9;
  // Additive accumulation keeps interior pixels at full alpha (9 x 1/9).
  sg.globalCompositeOperation = 'lighter';
  for (let oy = -2; oy <= 2; oy += 2) for (let ox = -2; ox <= 2; ox += 2) sg.drawImage(hard, ox, oy);
  return soft;
}

/** Cached vignette (3.1/3.6) at lightmap size. */
function buildVignette(W: number, H: number): HTMLCanvasElement {
  const v = makeCanvas(W, H);
  const g = v.getContext('2d')!;
  const cx = W / 2;
  const cy = H / 2;
  const grad = g.createRadialGradient(cx, cy, 0.45 * Math.min(W, H), cx, cy, 0.72 * Math.max(W, H));
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${VIGNETTE_MAX})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  return v;
}

/** Bilinear upscale of a lightmap into a board-sized cache (replaces its contents). */
function upscale(src: HTMLCanvasElement, dst: HTMLCanvasElement): void {
  const g = dst.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'copy';
  g.imageSmoothingEnabled = true;
  // 'low' = bilinear: smooth enough at 8 px/tile and several times cheaper than 'high'.
  g.imageSmoothingQuality = 'low';
  g.drawImage(src, 0, 0, dst.width, dst.height);
  g.globalCompositeOperation = 'source-over';
}

const rgbKey = (c: Rgb): number => ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);

// --- the pass -----------------------------------------------------------------------

export function createLighting(): LightingPass {
  // Map-sized caches (reset()).
  let sites: MapSites | null = null;
  let dark: HTMLCanvasElement | null = null;
  let glow: HTMLCanvasElement | null = null;
  let outdoorMask: HTMLCanvasElement | null = null;
  let passMask: HTMLCanvasElement | null = null;
  let vignette: HTMLCanvasElement | null = null;
  // Stamps (size independent; kept across reset()).
  let darkStamp: HTMLCanvasElement | null = null;
  const glowStamps = new Map<number, HTMLCanvasElement>();
  const darkenStamps = new Map<number, HTMLCanvasElement>();

  // Effective lights of the last rebuild (for levelAt), typed and reused.
  let cap = 0;
  let n = 0;
  let xs = new Float32Array(0);
  let ys = new Float32Array(0);
  let rs = new Float32Array(0);
  let ks = new Float32Array(0);
  let dk = new Uint8Array(0);

  // levelAt memo per tile, valid while `memoGen` matches.
  let memo = new Float32Array(0);
  let memoAt = new Uint32Array(0);
  let memoGen = 1;
  let env: Readonly<EraLight> | null = null;

  // Board-sized upscaled copies of dark/glow, refreshed on rebuild.
  let darkBig: HTMLCanvasElement | null = null;
  let glowBig: HTMLCanvasElement | null = null;

  let lastHash = -1;
  let lastBuild = -Infinity;
  let valid = false;
  /** The glow cache is refreshed one frame after `dark` (halves the refresh spike). */
  let glowPending = false;

  const ensureCap = (m: number): void => {
    if (m <= cap) return;
    cap = Math.max(m, cap * 2, 32);
    xs = new Float32Array(cap);
    ys = new Float32Array(cap);
    rs = new Float32Array(cap);
    ks = new Float32Array(cap);
    dk = new Uint8Array(cap);
  };

  const glowStamp = (c: Rgb): HTMLCanvasElement => {
    const key = rgbKey(c);
    let s = glowStamps.get(key);
    if (!s) {
      s = makeStamp(c, 0.34, 0.5, 0.1, 0.9);
      glowStamps.set(key, s);
    }
    return s;
  };

  const darkenStamp = (c: Rgb): HTMLCanvasElement => {
    const key = rgbKey(c);
    let s = darkenStamps.get(key);
    if (!s) {
      s = makeStamp(c, 1, 0.45, 0.7, 1);
      darkenStamps.set(key, s);
    }
    return s;
  };

  const levelAt = (x: number, y: number): number => {
    const s = sites;
    if (!s || !env) return 1;
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= s.w || ty >= s.h) return 1;
    const i = ty * s.w + tx;
    if (memoAt[i] === memoGen) return memo[i]!;
    const v = lightLevel(tx, ty, env, s.outdoor[ty]![tx]!, n, xs, ys, rs, ks, dk);
    memo[i] = v;
    memoAt[i] = memoGen;
    return v;
  };

  const ensureMaps = (f: GfxFrame): void => {
    if (sites === f.sites && dark && glow && outdoorMask && passMask && vignette) return;
    sites = f.sites;
    const W = sites.w * LIGHT_RES;
    const H = sites.h * LIGHT_RES;
    dark = makeCanvas(W, H);
    glow = makeCanvas(W, H);
    const s = sites;
    outdoorMask = buildMask(s, NIGHT.moon, (x, y) => s.outdoor[y]![x]!);
    passMask = buildMask(s, [255, 255, 255], (x, y) => s.passable[y]![x]!);
    vignette = buildVignette(W, H);
    memo = new Float32Array(s.w * s.h);
    memoAt = new Uint32Array(s.w * s.h);
    valid = false;
  };

  /** Recompute the effective lights and redraw both lightmaps. */
  const rebuild = (f: GfxFrame): void => {
    const e = f.env;
    const W = dark!.width;
    const H = dark!.height;
    const tSec = f.now / 1000;
    const reduced = f.motion.reduced;
    const lights = f.lights;
    ensureCap(lights.length);
    n = lights.length;
    for (let i = 0; i < n; i++) {
      const l = lights[i]!;
      const fl = flickerFactor(l.flicker, l.seed, tSec, reduced);
      xs[i] = l.x;
      ys[i] = l.y;
      rs[i] = l.radius * (1 + 0.3 * (fl - 1));
      ks[i] = l.intensity * fl * (l.lamp ? e.lamp : 1);
      dk[i] = l.darken ? 1 : 0;
    }

    // dark: tint, vignette, then carve moon, lights and the floor minimum.
    const d = dark!.getContext('2d')!;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.globalAlpha = 1;
    d.clearRect(0, 0, W, H);
    d.fillStyle = `rgba(${e.tint[0]},${e.tint[1]},${e.tint[2]},${e.darkAlpha})`;
    d.fillRect(0, 0, W, H);
    d.drawImage(vignette!, 0, 0);
    d.globalCompositeOperation = 'destination-out';
    if (e.moon > 0) {
      d.globalAlpha = clamp01(e.moon);
      d.drawImage(outdoorMask!, 0, 0);
    }
    const ds = darkStamp!;
    for (let i = 0; i < n; i++) {
      if (dk[i]) continue;
      const k = ks[i]!;
      const r = rs[i]! * LIGHT_RES;
      if (k <= 0.004 || r <= 0) continue;
      d.globalAlpha = k > 1 ? 1 : k;
      d.drawImage(ds, xs[i]! * LIGHT_RES - r, ys[i]! * LIGHT_RES - r, 2 * r, 2 * r);
    }
    const carve = floorCarveAlpha(e.darkAlpha, e.floorCap);
    if (carve > 0) {
      d.globalAlpha = carve;
      d.drawImage(passMask!, 0, 0);
    }
    // Silence darkeners add darkness back (after the floor carve, 6.3).
    d.globalCompositeOperation = 'source-over';
    for (let i = 0; i < n; i++) {
      if (!dk[i]) continue;
      const r = rs[i]! * LIGHT_RES;
      if (r <= 0) continue;
      d.globalAlpha = clamp01(DARKEN_ALPHA * (ks[i]! > 0 ? Math.min(1, ks[i]! / 0.6) : 1));
      d.drawImage(darkenStamp(e.tint), xs[i]! * LIGHT_RES - r, ys[i]! * LIGHT_RES - r, 2 * r, 2 * r);
    }

    // glow: cold sheen outdoors, then additive coloured stamps.
    const g = glow!.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    if (e.moon > 0) {
      g.globalAlpha = clamp01((MOON_SHEEN * e.moon) / 0.36);
      g.drawImage(outdoorMask!, 0, 0);
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      if (dk[i]) continue;
      const l = lights[i]!;
      let k = ks[i]!;
      if (l.kind === 'overhead') k *= OVERHEAD_GLOW;
      const r = rs[i]! * LIGHT_RES;
      if (k <= 0.004 || r <= 0) continue;
      g.globalAlpha = k > 1 ? 1 : k;
      g.drawImage(glowStamp(l.color), xs[i]! * LIGHT_RES - r, ys[i]! * LIGHT_RES - r, 2 * r, 2 * r);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    memoGen = (memoGen + 1) >>> 0 || 1;
    valid = true;
  };

  return {
    reset() {
      sites = null;
      dark = null;
      glow = null;
      darkBig = null;
      glowBig = null;
      outdoorMask = null;
      passMask = null;
      vignette = null;
      valid = false;
      glowPending = false;
      lastHash = -1;
    },
    clear() {
      valid = false;
      lastHash = -1;
    },
    draw(f: GfxFrame) {
      const { ctx, T } = f;
      const mw = f.mapW * T;
      const mh = f.mapH * T;

      // Live desaturation over layers 1-4 while the era transition runs (3.4);
      // once settled, terrain bakes it.
      if (f.era.t < 1 && f.env.desat > 0.001) {
        ctx.globalCompositeOperation = 'saturation';
        ctx.globalAlpha = clamp01(f.env.desat);
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, mw, mh);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      if (!darkStamp) darkStamp = makeStamp([255, 255, 255], 1, 0.45, 0.7, 1);
      ensureMaps(f);
      env = f.env;

      if (!darkBig || darkBig.width !== mw || darkBig.height !== mh) {
        darkBig = makeCanvas(mw, mh);
        glowBig = makeCanvas(mw, mh);
        valid = false;
      }

      // 3.7: rebuild only on change; flicker and era fades at most every REFRESH_MS.
      const animating = (!f.motion.reduced && anyFlicker(f.lights)) || f.era.t < 1;
      const h = lightsHash(f.lights, f.env);
      // A clock jump backwards (new battle, tests) never stalls the refresh.
      if (f.now < lastBuild) lastBuild = -Infinity;
      const first = !valid;
      if (glowPending && valid) {
        upscale(glow!, glowBig!);
        glowPending = false;
      } else if (first || h !== lastHash || (animating && f.now - lastBuild >= REFRESH_MS)) {
        rebuild(f);
        lastBuild = f.now;
        lastHash = h;
        upscale(dark!, darkBig);
        if (first) upscale(glow!, glowBig!);
        else glowPending = true;
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(darkBig, 0, 0);
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(glowBig!, 0, 0);
      ctx.globalCompositeOperation = 'source-over';

      f.levelAt = levelAt;
    },
  };
}
