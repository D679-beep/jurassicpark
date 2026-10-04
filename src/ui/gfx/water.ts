// Canal and reflecting-pool per-frame pass (visual-style.md 4.6, 10; layer 2).
// Owner: WS1 (Terrain & objects). The water base (gradient band, kerbs, bank
// lines, pool basin and rim) is in the terrain cache; this pass adds the
// motion on top, on water tiles only (intact bridge decks are clipped out):
//   - canal ripples: per canal row one pre-rendered ripple strip in two
//     alpha groups, drawn twice with a wrap offset under a clip of the
//     visible water tiles (a handful of drawImage calls per row instead of
//     ~3 wavelets per tile per frame, so a 2-row canal stays cheap);
//   - lantern/brazier reflections (`sites.reflections`) as shimmering
//     vertical streaks of soft dashes, `lighter`, scaled by the era lamp;
//   - the pool's slow shimmer band and pulsing rune glow, and its (half
//     strength) reflections.
// Reduced motion: everything is drawn at a fixed time (static, no drift,
// no shimmer, no pulse).
import type { MapObject } from '../../engine';
import { POOL, WATER, rgba } from '../palette';
import { hash } from './noise';
import type { GfxFrame, MapSites, Rgb, WaterPass } from './types';

const R = Math.round;
const TAU = Math.PI * 2;

/** One horizontal run of canal tiles in a row (bridge tiles included), in tiles. */
interface CanalRow {
  readonly y: number;
  readonly x0: number;
  readonly x1: number;
  /** Ripple strips, alpha groups A and B (width (x1-x0+1)*T, height T). */
  readonly strips: readonly [HTMLCanvasElement, HTMLCanvasElement];
  /** Drift direction (alternate rows drift the other way). */
  readonly dir: 1 | -1;
}

/** Ripple alpha group pulse (spec: 0.45 + 0.5 * (0.5 + 0.5 sin(now/700 + phase))). */
export function rippleAlpha(now: number, phase: number): number {
  return 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(now / 700 + phase));
}

/** Drift offset of a ripple strip in px: one tile per 2.6 s, wrapped to the strip width. */
export function rippleOffset(now: number, T: number, width: number): number {
  if (width <= 0) return 0;
  const o = ((now / 2600) * T) % width;
  return o < 0 ? o + width : o;
}

/** True when a water tile shows water this frame (no bridge over it, or the bridge is drawn burned). */
export function waterVisible(bridge: string | null, objects: readonly MapObject[], unburned: Readonly<Record<string, unknown>>): boolean {
  if (bridge === null) return true;
  for (const o of objects) if (o.kind === 'bridge' && o.id === bridge) return o.burned && unburned[bridge] === undefined;
  return true;
}

export function createWater(): WaterPass {
  let builtT = 0;
  let builtSites: MapSites | null = null;
  let rows: CanalRow[] = [];
  /** Water tile index per (y*w+x), -1 if none. */
  let tileIndex: Int32Array = new Int32Array(0);
  /** Visible flag per water tile (refreshed when the burn signature changes). */
  let visible: Uint8Array = new Uint8Array(0);
  let visSig = -1;
  const dashSprites = new Map<string, HTMLCanvasElement>();
  let poolBox = { x0: 0, y0: 0, x1: 0, y1: 0, any: false };

  const build = (f: GfxFrame): void => {
    const s = f.sites;
    const T = f.T;
    builtT = T;
    builtSites = s;
    visSig = -1;
    tileIndex = new Int32Array(s.w * s.h).fill(-1);
    s.water.forEach((w, i) => (tileIndex[w.y * s.w + w.x] = i));
    visible = new Uint8Array(s.water.length);
    rows = [];
    for (let y = 0; y < s.h; y++) {
      let x = 0;
      while (x < s.w) {
        if (s.material[y]![x] !== 'canal') {
          x++;
          continue;
        }
        let x1 = x;
        while (x1 + 1 < s.w && s.material[y]![x1 + 1] === 'canal') x1++;
        rows.push({ y, x0: x, x1, strips: makeStrips(T, x, x1, y), dir: y % 2 === 0 ? 1 : -1 });
        x = x1 + 1;
      }
    }
    let px0 = Infinity;
    let py0 = Infinity;
    let px1 = -Infinity;
    let py1 = -Infinity;
    for (const w of s.water) {
      if (!w.pool) continue;
      px0 = Math.min(px0, w.x);
      py0 = Math.min(py0, w.y);
      px1 = Math.max(px1, w.x + 1);
      py1 = Math.max(py1, w.y + 1);
    }
    poolBox = { x0: px0, y0: py0, x1: px1, y1: py1, any: px1 > px0 };
    dashSprites.clear();
  };

  const dashFor = (c: Rgb): HTMLCanvasElement => {
    const key = `${c[0]},${c[1]},${c[2]}`;
    let sp = dashSprites.get(key);
    if (!sp) {
      sp = makeDash(c);
      dashSprites.set(key, sp);
    }
    return sp;
  };

  return {
    reset() {
      builtT = 0;
      builtSites = null;
    },
    clear() {
      visSig = -1;
    },
    draw(f: GfxFrame) {
      const s = f.sites;
      if (s.water.length === 0) return;
      if (builtT !== f.T || builtSites !== s) build(f);
      const { ctx, T } = f;
      const objects = f.state.map.objects;
      const unburned = f.input.overrides.unburnedBridges;
      // Visibility only changes when a bridge burns: refresh on a cheap signature.
      let sig = 0;
      let bi = 0;
      for (const o of objects) {
        if (o.kind !== 'bridge') continue;
        if (o.burned && unburned[o.id] === undefined) sig |= 1 << bi % 31;
        bi++;
      }
      if (sig !== visSig) {
        visSig = sig;
        s.water.forEach((w, i) => (visible[i] = waterVisible(w.bridge, objects, unburned) ? 1 : 0));
      }
      const now = f.motion.reduced ? 0 : f.now;
      const lamp = f.env.lamp;

      // --- canal ripples ---------------------------------------------------------
      ctx.save();
      ctx.beginPath();
      let anyCanal = false;
      for (let i = 0; i < s.water.length; i++) {
        const w = s.water[i]!;
        if (w.pool || !visible[i]) continue;
        // Extend horizontal runs to keep the clip path short.
        ctx.rect(w.x * T, w.y * T, T, T);
        anyCanal = true;
      }
      if (anyCanal) {
        ctx.clip();
        for (const row of rows) {
          const wpx = (row.x1 - row.x0 + 1) * T;
          const o = rippleOffset(now, T, wpx);
          const off = row.dir === 1 ? o : wpx - o;
          const bx = row.x0 * T;
          const by = row.y * T;
          for (let gi = 0; gi < 2; gi++) {
            ctx.globalAlpha = f.motion.reduced ? 0.7 : rippleAlpha(now, gi * Math.PI + row.y);
            const sp = row.strips[gi]!;
            ctx.drawImage(sp, bx + off, by);
            ctx.drawImage(sp, bx + off - wpx, by);
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // --- pool shimmer and rune glow ------------------------------------------------
      if (poolBox.any) {
        const pulse = f.motion.reduced ? 0.85 : 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((f.now / 3000) * TAU));
        const rim = Math.max(2, R(T * 0.1));
        const bw = (poolBox.x1 - poolBox.x0) * T;
        const bandX = f.motion.reduced ? -1 : poolBox.x0 * T + ((f.now % 4000) / 4000) * (bw + T) - T * 0.5;
        for (let i = 0; i < s.water.length; i++) {
          const w = s.water[i]!;
          if (!w.pool) continue;
          const x0 = w.x * T;
          const y0 = w.y * T;
          if (bandX >= 0 && bandX + T * 0.35 > x0 && bandX < x0 + T) {
            const l = Math.max(x0 + rim, bandX);
            const r = Math.min(x0 + T - rim, bandX + T * 0.35);
            if (r > l) {
              ctx.fillStyle = 'rgba(190,240,255,0.15)';
              ctx.fillRect(R(l), y0 + rim, R(r - l), T - 2 * rim);
            }
          }
          // Rune ticks along the inner rim.
          ctx.globalAlpha = pulse;
          ctx.fillStyle = POOL.rune;
          const tick = Math.max(1, R(T * 0.06));
          const len = Math.max(2, R(T * 0.14));
          const isPool = (x: number, y: number): boolean => s.material[y]?.[x] === 'pool';
          if (!isPool(w.x, w.y - 1)) for (let k = 0; k < 3; k++) ctx.fillRect(R(x0 + T * (0.2 + 0.3 * k) - len / 2), y0 + rim + tick, len, tick);
          if (!isPool(w.x, w.y + 1)) for (let k = 0; k < 3; k++) ctx.fillRect(R(x0 + T * (0.2 + 0.3 * k) - len / 2), y0 + T - rim - 2 * tick, len, tick);
          if (!isPool(w.x - 1, w.y)) ctx.fillRect(x0 + rim + tick, R(y0 + T / 2 - len / 2), tick, len);
          if (!isPool(w.x + 1, w.y)) ctx.fillRect(x0 + T - rim - 2 * tick, R(y0 + T / 2 - len / 2), tick, len);
          ctx.globalAlpha = 1;
        }
      }

      // --- reflections -------------------------------------------------------------------
      ctx.globalCompositeOperation = 'lighter';
      const dh = Math.max(1, R(T / 18));
      for (const pr of s.reflections) {
        const wi = tileIndex[pr.y * s.w + pr.x]!;
        if (wi < 0 || !visible[wi]) continue;
        const light = s.staticLights[pr.light];
        if (!light) continue;
        const w = s.water[wi]!;
        const strength = (w.pool ? 0.5 : 1) * (1 - pr.dy / 4) * (light.lamp ? lamp : 1);
        if (strength <= 0) continue;
        const sp = dashFor(light.color);
        const cx = (pr.x + 0.5) * T;
        const y0 = pr.y * T;
        for (let i = 0; i < 5; i++) {
          const wid = (0.3 - 0.03 * i) * T * (0.7 + 0.3 * Math.sin(now / 240 + 1.7 * i + 9 * light.seed));
          const jx = 0.04 * T * Math.sin(now / 300 + i);
          ctx.globalAlpha = Math.min(1, (0.65 - 0.07 * i) * strength);
          ctx.drawImage(sp, R(cx + jx - wid / 2), R(y0 + T * (0.18 + 0.16 * i) - dh / 2), Math.max(2, R(wid)), dh);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

/** Two ripple strips (alpha groups A / B) for a canal row run; seamless when wrapped at the strip width. */
function makeStrips(T: number, x0: number, x1: number, y: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const n = x1 - x0 + 1;
  const width = n * T;
  const out: HTMLCanvasElement[] = [];
  for (let gi = 0; gi < 2; gi++) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, width);
    cv.height = Math.max(1, T);
    out.push(cv);
  }
  const th = Math.max(1, R(T / 22));
  const ys = [0.3, 0.52, 0.74];
  for (let i = 0; i < n; i++) {
    const x = x0 + i;
    for (let k = 0; k < 3; k++) {
      const h = hash(x, y, 200 + k);
      const len = (0.35 + 0.3 * h) * T;
      const px = i * T + hash(x, y, 210 + k) * T;
      const py = ys[k]! * T + (hash(x, y, 220 + k) - 0.5) * T * 0.06;
      const g = out[(i + k) % 2]!.getContext('2d');
      if (!g) continue;
      g.fillStyle = WATER.ripple;
      for (const shift of [0, -width]) {
        const sx = px + shift;
        if (sx + len < 0 || sx > width) continue;
        // A tapered wavelet: a thin lens with a brighter crest.
        g.beginPath();
        g.moveTo(sx, py);
        g.quadraticCurveTo(sx + len / 2, py - th * 1.6, sx + len, py);
        g.quadraticCurveTo(sx + len / 2, py + th * 0.6, sx, py);
        g.closePath();
        g.fill();
      }
    }
  }
  return [out[0]!, out[1]!];
}

/** Soft horizontal dash for reflection streaks (white-hot centre fading to the light colour). */
function makeDash(c: Rgb): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 4;
  const g = cv.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 32, 0);
    grad.addColorStop(0, rgba(c, 0));
    grad.addColorStop(0.3, rgba(c, 0.85));
    grad.addColorStop(0.5, `rgba(${Math.min(255, c[0] + 40)},${Math.min(255, c[1] + 50)},${Math.min(255, c[2] + 60)},1)`);
    grad.addColorStop(0.7, rgba(c, 0.85));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 4);
  }
  return cv;
}
