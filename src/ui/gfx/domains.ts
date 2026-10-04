// Domain visuals: ground fill and patterns (layer 4b), upper layer (domes,
// bolts, flames, rays, rings; layer 11) and Domain lights (visual-style.md
// 1.5, 6.3 "Bespoke Domains").
// Owner: WS4 (FX, Domains, animation).
//
// Ground: a low-alpha fill (palette.DOMAIN ground) plus the outline of the
// Domain's tiles only (never per-tile edges, so a Domain never looks like
// the blue move tiles), with a soft glow under the line; Tempest's edge is
// dashed and crawling, Bulwark's is solid and thicker. Kind patterns: Pyre
// heat shimmer, Bulwark hex lattice + shimmer band, Sanctuary warm pool,
// Silence local desaturation.
// Upper: Tempest wind streaks + random bolts, Pyre flame tongues on the
// edge + rising embers, Bulwark shield dome rim, Sanctuary rotating rays +
// motes, Silence contracting rings + inward motes.
// Activation (`domain` step): the outline grows from the owner (p 0-0.6,
// easeOutCubic), the light ramps in, plus a bespoke extra per kind. End
// (`domainEnd` step): the outline contracts 0.3T and fades, the light ramps
// out. The engine drops a Domain from the state before its domainEnd step
// plays, so a Domain that vanished from `f.domains` keeps being drawn
// ("lingers") while the queue still runs, until its end step finishes.
//
// Ambient motes are procedural (position from `now` and hashes, no storage)
// and share DOMAIN_AMBIENT_SHARE of the 6.5 particle budget (particles.ts).
// Reduced motion: static patterns, no ambient motes, no random bolts.
import type { DomainKind, Pos } from '../../engine';
import { DOMAIN } from '../palette';
import { ambientAllowed } from '../settings';
import { clamp01, easeInQuad, easeOutBack, easeOutCubic } from './ease';
import { hash, hashString } from './noise';
import { BoltPath, DOMAIN_AMBIENT_SHARE, GlowSprites, drawLightning, makeCanvas, rampColor, RAMP } from './particles';
import type { DisplayDomain, DomainsPass, GfxFrame, LightSource, Rgb } from './types';

/** Shield dome radius (tiles, 6.3 Bulwark). */
const DOME_R = 3.4;
const AMBIENT_WANT: Record<DomainKind, number> = { tempest: 18, pyre: 20, bulwark: 0, sanctuary: 12, silence: 8 };

interface Look {
  groundRgb: Rgb;
  groundA: number;
}

function parseRgba(s: string): Look {
  const m = /rgba?\(([^)]+)\)/.exec(s);
  const parts = (m?.[1] ?? '0,0,0,0').split(',').map((x) => Number(x.trim()));
  return { groundRgb: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], groundA: parts[3] ?? 1 };
}

const GROUND: Record<DomainKind, Look> = {
  tempest: parseRgba(DOMAIN.tempest.ground),
  pyre: parseRgba(DOMAIN.pyre.ground),
  bulwark: parseRgba(DOMAIN.bulwark.ground),
  sanctuary: parseRgba(DOMAIN.sanctuary.ground),
  silence: parseRgba(DOMAIN.silence.ground),
};

const rgbStr = (c: Rgb): string => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Outline geometry of a tile set, in tile units. */
export interface DomainOutline {
  /** Closed loops of vertices [x0, y0, x1, y1, ...] (collinear points merged). */
  loops: number[][];
  /** Unit boundary segments x0, y0, x1, y1 (outward normal on the left of travel). */
  segs: number[];
}

/**
 * The outline of a set of tiles: closed clockwise loops around the union and
 * the unit-length boundary segments. Pure, for tests.
 */
export function outlineTiles(tiles: readonly Pos[]): DomainOutline {
  const set = new Set<number>();
  const key = (x: number, y: number): number => (y + 1024) * 4096 + (x + 1024);
  for (const t of tiles) set.add(key(t.x, t.y));
  const has = (x: number, y: number): boolean => set.has(key(x, y));
  const segs: number[] = [];
  // Directed edges, clockwise around each tile's outside sides.
  const next = new Map<number, number[]>();
  const vkey = (x: number, y: number): number => (y + 1024) * 4096 + (x + 1024);
  const addEdge = (x0: number, y0: number, x1: number, y1: number): void => {
    segs.push(x0, y0, x1, y1);
    const k = vkey(x0, y0);
    const list = next.get(k);
    if (list) list.push(x1, y1);
    else next.set(k, [x1, y1]);
  };
  for (const t of tiles) {
    const { x, y } = t;
    if (!has(x, y - 1)) addEdge(x, y, x + 1, y);
    if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
    if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
    if (!has(x - 1, y)) addEdge(x, y + 1, x, y);
  }
  const loops: number[][] = [];
  for (;;) {
    let startK = -1;
    for (const [k, v] of next) {
      if (v.length > 0) {
        startK = k;
        break;
      }
    }
    if (startK < 0) break;
    const sx = (startK % 4096) - 1024;
    const sy = Math.floor(startK / 4096) - 1024;
    const pts: number[] = [sx, sy];
    let cx = sx;
    let cy = sy;
    for (let guard = 0; guard < 10000; guard++) {
      const list = next.get(vkey(cx, cy));
      if (!list || list.length === 0) break;
      const ny = list.pop()!;
      const nx = list.pop()!;
      cx = nx;
      cy = ny;
      if (cx === sx && cy === sy) break;
      pts.push(cx, cy);
    }
    // Merge collinear vertices.
    const out: number[] = [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const px = pts[((i - 1 + n) % n) * 2]!;
      const py = pts[((i - 1 + n) % n) * 2 + 1]!;
      const qx = pts[i * 2]!;
      const qy = pts[i * 2 + 1]!;
      const rx = pts[((i + 1) % n) * 2]!;
      const ry = pts[((i + 1) % n) * 2 + 1]!;
      if ((qx - px) * (ry - qy) - (qy - py) * (rx - qx) !== 0) out.push(qx, qy);
    }
    if (out.length >= 6) loops.push(out);
  }
  return { loops, segs };
}

interface Geom {
  tilesRef: readonly Pos[];
  T: number;
  outline: DomainOutline;
  path: Path2D | null;
}

interface Tracked {
  kind: DomainKind;
  tiles: Pos[];
  cx: number;
  cy: number;
  geom: Geom | null;
  /** Seen this frame in f.domains. */
  seen: boolean;
  /** Its domainEnd step has been seen active. */
  ending: boolean;
  /** Tempest: ambient bolt timer (ms) and the current bolt. */
  boltAcc: number;
  boltNext: number;
  boltCount: number;
  boltAge: number;
  boltX: number;
  boltY: number;
}

/** What one frame draws for a Domain. */
interface View {
  id: string;
  kind: DomainKind;
  tiles: readonly Pos[];
  /** Owner centre in tiles (display position + pose offset, tile centre). */
  cx: number;
  cy: number;
  geom: Geom;
  /** Outline scale about the owner (activation growth / end contraction). */
  scale: number;
  /** Overall alpha (end fade, reduced-motion fade-in). */
  alpha: number;
  /** Light ramp 0..1. */
  light: number;
  /** Activation progress, -1 when not activating. */
  act: number;
  /** Activation step duration (ms). */
  actDur: number;
  /** End progress, -1 when not ending. */
  end: number;
  tr: Tracked;
}

export function createDomains(): DomainsPass {
  const tracked = new Map<string, Tracked>();
  const views: View[] = [];
  const glows = new GlowSprites();
  const bolt = new BoltPath();
  const lightPool: LightSource[] = [];
  let lightUsed = 0;
  let frameStamp = -1;
  // Cached sprites (per T).
  let spriteT = 0;
  let hexSprite: HTMLCanvasElement | OffscreenCanvas | null = null;
  let raySprite: HTMLCanvasElement | OffscreenCanvas | null = null;
  let bandSprite: HTMLCanvasElement | OffscreenCanvas | null = null;

  function geomFor(tr: Tracked, tiles: readonly Pos[], T: number): Geom {
    const g = tr.geom;
    if (g && g.tilesRef === tiles && g.T === T) return g;
    const outline = outlineTiles(tiles);
    let path: Path2D | null = null;
    if (typeof Path2D !== 'undefined') {
      path = new Path2D();
      for (const loop of outline.loops) {
        path.moveTo(loop[0]! * T, loop[1]! * T);
        for (let i = 2; i < loop.length; i += 2) path.lineTo(loop[i]! * T, loop[i + 1]! * T);
        path.closePath();
      }
    }
    const ng: Geom = { tilesRef: tiles, T, outline, path };
    tr.geom = ng;
    return ng;
  }

  function ensureSprites(T: number): void {
    if (spriteT === T) return;
    spriteT = T;
    hexSprite = buildHexSprite(T);
    raySprite = buildRaySprite(T);
    bandSprite = buildBandSprite(T);
  }

  /** Builds this frame's view list once (ground runs first; lights and upper reuse it). */
  function buildViews(f: GfxFrame): void {
    if (frameStamp === f.now) return;
    frameStamp = f.now;
    views.length = 0;
    const a = f.input.active;
    const reduced = f.motion.reduced;
    for (const tr of tracked.values()) tr.seen = false;
    for (const dd of f.domains) addLive(f, dd, a, reduced);
    // Domains that left the state but whose end has not played yet.
    for (const [id, tr] of tracked) {
      if (tr.seen) continue;
      const endingNow = a !== null && a.step.kind === 'domainEnd' && a.step.event.type === 'domainEnded' && a.step.event.unitId === id;
      if (endingNow) tr.ending = true;
      else if (tr.ending || f.input.showHighlights || f.motion.speed === 'instant') {
        tracked.delete(id);
        continue;
      }
      const geom = geomFor(tr, tr.tiles, f.T);
      const q = endingNow ? a.progress : -1;
      const k = q < 0 ? 0 : easeInQuad(q);
      views.push({
        id,
        kind: tr.kind,
        tiles: tr.tiles,
        cx: tr.cx,
        cy: tr.cy,
        geom,
        scale: 1 - (0.3 / (DOME_R + 0.1)) * k,
        alpha: 1 - k,
        light: 1 - (q < 0 ? 0 : clamp01(q)),
        act: -1,
        actDur: 0,
        end: q,
        tr,
      });
    }
  }

  function addLive(f: GfxFrame, dd: DisplayDomain, a: GfxFrame['input']['active'], reduced: boolean): void {
    const id = dd.domain.ownerId;
    let tr = tracked.get(id);
    if (!tr) {
      tr = { kind: dd.domain.kind, tiles: [], cx: 0, cy: 0, geom: null, seen: true, ending: false, boltAcc: 0, boltNext: 900, boltCount: 0, boltAge: 1e9, boltX: 0, boltY: 0 };
      tracked.set(id, tr);
    }
    tr.seen = true;
    tr.ending = false;
    tr.kind = dd.domain.kind;
    const pose = f.poses.get(id);
    const cx = dd.center.x + (pose?.dx ?? 0) + 0.5;
    const cy = dd.center.y + (pose?.dy ?? 0) + 0.5;
    tr.cx = cx;
    tr.cy = cy;
    const prevRef = tr.geom?.tilesRef;
    const geom = geomFor(tr, dd.tiles, f.T);
    // Own copy of the tiles, for drawing the Domain after it left the state (lingering).
    if (prevRef !== dd.tiles) tr.tiles = dd.tiles.map((p) => ({ x: p.x, y: p.y }));
    let act = -1;
    let actDur = 0;
    if (a && a.step.kind === 'domain' && a.step.event.type === 'domainActivated' && a.step.event.unitId === id) {
      act = a.progress;
      actDur = a.step.duration;
    }
    const grow = act < 0 ? 1 : reduced ? 1 : Math.max(0.04, easeOutCubic(act / 0.6));
    views.push({
      id,
      kind: dd.domain.kind,
      tiles: dd.tiles,
      cx,
      cy,
      geom,
      scale: grow,
      alpha: act < 0 ? 1 : reduced ? clamp01(act / 0.6) : clamp01(act / 0.15),
      light: act < 0 ? 1 : easeOutCubic(act),
      act,
      actDur,
      end: -1,
      tr,
    });
  }

  function light(f: GfxFrame, x: number, y: number, radius: number, intensity: number, color: Rgb, flicker: number, seed: number, darken = false): void {
    if (intensity <= 0.01) return;
    let l = lightPool[lightUsed];
    if (!l) {
      l = { kind: 'domain', x, y, radius, intensity, color, flicker, seed, lamp: false };
      lightPool.push(l);
    }
    lightUsed++;
    l.kind = 'domain';
    l.x = x;
    l.y = y;
    l.radius = radius;
    l.intensity = intensity;
    l.color = color;
    l.flicker = flicker;
    l.seed = seed;
    l.lamp = false;
    l.darken = darken ? true : undefined;
    f.lights.push(l);
  }

  /** Applies the view's scale about the owner (activation growth / end contraction). */
  function withScale(f: GfxFrame, v: View): boolean {
    if (v.scale === 1) return false;
    const { ctx, T } = f;
    ctx.save();
    ctx.translate(v.cx * T, v.cy * T);
    ctx.scale(v.scale, v.scale);
    ctx.translate(-v.cx * T, -v.cy * T);
    return true;
  }

  // --- layer 4b -----------------------------------------------------------------------------

  function drawGroundOne(f: GfxFrame, v: View): void {
    const { ctx, T } = f;
    const path = v.geom.path;
    if (!path) return;
    const reduced = f.motion.reduced;
    const look = GROUND[v.kind];
    const now = f.now;
    const scaled = withScale(f, v);
    // Fill.
    let ga = look.groundA;
    if (v.kind === 'pyre' && !reduced) ga = 0.1 + 0.02 * Math.sin(now / 200);
    ctx.globalAlpha = ga * v.alpha;
    ctx.fillStyle = rgbStr(look.groundRgb);
    ctx.fill(path, 'evenodd');
    // Kind patterns, clipped to the Domain.
    if (v.kind === 'silence') {
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = 0.6 * v.alpha;
      ctx.fillStyle = '#808080';
      ctx.fill(path, 'evenodd');
      ctx.globalCompositeOperation = 'source-over';
    } else if (v.kind === 'bulwark' || v.kind === 'sanctuary') {
      ctx.save();
      ctx.clip(path, 'evenodd');
      if (v.kind === 'bulwark' && hexSprite) {
        const s = hexSprite.width;
        ctx.globalAlpha = v.alpha;
        ctx.drawImage(hexSprite as CanvasImageSource, Math.round(v.cx * T - s / 2), Math.round(v.cy * T - s / 2));
        if (bandSprite && !reduced) {
          // Shimmer band sweeping across every 2400 ms.
          const ph = (now % 2400) / 2400;
          const span = (DOME_R * 2 + 2) * T;
          const bx = v.cx * T - span / 2 + ph * span;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.5 * v.alpha;
          ctx.translate(bx, v.cy * T);
          ctx.rotate(0.45);
          ctx.drawImage(bandSprite as CanvasImageSource, -bandSprite.width / 2, -bandSprite.height / 2);
        }
      } else if (v.kind === 'sanctuary') {
        ctx.globalCompositeOperation = 'lighter';
        glows.draw(ctx, DOMAIN.sanctuary.light, v.cx * T, v.cy * T, (DOME_R + 0.6) * T, 0.22 * v.alpha);
      }
      ctx.restore();
    }
    // Edge: soft glow under a crisp line, outline only.
    const lw = v.kind === 'bulwark' ? Math.max(3, T / 8) : Math.max(2, T / 12);
    const edge = DOMAIN[v.kind].edge;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = edge;
    ctx.globalAlpha = 0.2 * v.alpha;
    ctx.lineWidth = (lw * 2.6) / v.scale;
    ctx.stroke(path);
    ctx.globalAlpha = v.alpha;
    ctx.lineWidth = lw / v.scale;
    if (v.kind === 'tempest') {
      ctx.setLineDash([T / 6, T / 10]);
      ctx.lineDashOffset = reduced ? 0 : -now / 40;
    } else if (v.kind === 'silence') ctx.setLineDash([T / 10, T / 12]);
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.lineJoin = 'miter';
    ctx.globalAlpha = 1;
    if (scaled) ctx.restore();
  }

  // --- layer 11 -----------------------------------------------------------------------------------

  /** Procedural ambient mote i of a Domain: life cycle t and a stable spawn tile/offset for the cycle. */
  function mote(v: View, i: number, now: number, life0: number, life1: number, salt: number): { t: number; x: number; y: number; h: number } {
    const s = hashString(v.id, salt);
    const life = life0 + (life1 - life0) * hash(i, 1, salt);
    const cyc = now / life + hash(i, 2, salt) + s;
    const k = Math.floor(cyc);
    const t = cyc - k;
    const n = v.tiles.length;
    const tile = v.tiles[Math.min(n - 1, Math.floor(hash(i, k, salt + 3) * n))]!;
    const h = hash(i, k, salt + 6);
    return { t, x: tile.x + 0.1 + 0.8 * hash(i, k, salt + 4), y: tile.y + 0.1 + 0.8 * hash(i, k, salt + 5), h };
  }

  function drawTempest(f: GfxFrame, v: View, motes: number): void {
    const { ctx, T } = f;
    const now = f.now;
    // Wind streaks: curved 3-point strokes 0.6-1.2T, #dbe8ff at 0.35, drifting diagonally 2T/s.
    if (motes > 0) {
      ctx.strokeStyle = '#dbe8ff';
      ctx.lineWidth = Math.max(1, T / 28);
      ctx.lineCap = 'round';
      const wa = 0.42 + 0.3 * (hashString(v.id, 9) - 0.5);
      const wx = Math.cos(wa);
      const wy = Math.sin(wa);
      for (let i = 0; i < motes; i++) {
        const m = mote(v, i, now, 600, 900, 11);
        const life = 600 + 300 * hash(i, 1, 11);
        const travel = 2 * (life / 1000) * m.t;
        const len = 0.6 + 0.6 * m.h;
        const x0 = (m.x - wx * len * 0.5 + wx * travel - wx * 0.6) * T;
        const y0 = (m.y - wy * len * 0.5 + wy * travel - wy * 0.6) * T;
        const x1 = x0 + wx * len * T;
        const y1 = y0 + wy * len * T;
        const bend = (m.h - 0.5) * 0.3 * T;
        ctx.globalAlpha = 0.35 * Math.sin(Math.PI * m.t) * v.alpha;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo((x0 + x1) / 2 - wy * bend, (y0 + y1) / 2 + wx * bend, x1, y1);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    ctx.globalCompositeOperation = 'lighter';
    // Activation: 3 bolts over the step (p 0.1 / 0.4 / 0.7).
    if (v.act >= 0 && !f.motion.reduced) {
      for (let b = 0; b < 3; b++) {
        const p0 = 0.1 + 0.3 * b;
        const q = (v.act - p0) / 0.14;
        if (q < 0 || q >= 1) continue;
        const tile = v.tiles[Math.floor(hash(b, 5, hashString(v.id)) * v.tiles.length)];
        if (tile) strike(f, tile.x + 0.5, tile.y + 0.82, 1 - q, b * 31 + Math.floor(q * 4));
      }
    }
    // Ambient bolt.
    const tr = v.tr;
    if (tr.boltAge < 220) strike(f, tr.boltX, tr.boltY, 1 - tr.boltAge / 220, tr.boltCount * 7 + Math.floor(tr.boltAge / 60));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function strike(f: GfxFrame, x: number, y: number, a: number, seed: number): void {
    const { ctx, T } = f;
    bolt.build((x + 0.3 * (hash(seed, 1, 3) - 0.5)) * T, (y - 3) * T, x * T, y * T, 6, T * 0.28, seed + 101);
    drawLightning(ctx, bolt, T, a);
    glows.draw(ctx, [143, 216, 255], x * T, (y - 0.15) * T, 0.8 * T, 0.6 * a);
  }

  function drawPyre(f: GfxFrame, v: View, motes: number): void {
    const { ctx, T } = f;
    const now = f.now;
    const reduced = f.motion.reduced;
    const segs = v.geom.outline.segs;
    const scaled = withScale(f, v);
    ctx.globalCompositeOperation = 'lighter';
    // Flame tongues along the edge (one per boundary side; kept off the HP-bar band of the tiles).
    const layers: readonly [string, number, number][] = [
      ['#ff5a1f', 1, 0.75],
      ['#ffb347', 0.62, 0.8],
      ['#ffe2a0', 0.32, 0.9],
    ];
    for (const [col, k, al] of layers) {
      ctx.fillStyle = col;
      ctx.globalAlpha = al * v.alpha;
      ctx.beginPath();
      for (let s = 0; s < segs.length; s += 4) {
        const x0 = segs[s]!;
        const y0 = segs[s + 1]!;
        const x1 = segs[s + 2]!;
        const y1 = segs[s + 3]!;
        const i = s / 4;
        const hr = hash(x0 * 3 + x1, y0 * 5 + y1, 21);
        const horiz = y0 === y1;
        const u = horiz ? (hr < 0.5 ? 0.1 + 0.14 * hr : 0.76 + 0.14 * hr) : 0.3 + 0.4 * hr;
        const px = (x0 + (x1 - x0) * u) * T;
        const py = (y0 + (y1 - y0) * u) * T;
        const hgt = (0.18 + 0.12 * (reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 140 + i * 1.7))) * T * k;
        const w = 0.09 * T * (0.6 + 0.4 * k);
        const sway = reduced ? 0 : Math.sin(now / 210 + i) * 0.04 * T;
        ctx.moveTo(px - w, py);
        ctx.quadraticCurveTo(px - w * 0.6 + sway * 0.5, py - hgt * 0.55, px + sway, py - hgt);
        ctx.quadraticCurveTo(px + w * 0.6 + sway * 0.5, py - hgt * 0.55, px + w, py);
        ctx.closePath();
      }
      ctx.fill();
    }
    if (scaled) ctx.restore();
    // Rising embers.
    for (let i = 0; i < motes; i++) {
      const m = mote(v, i, now, 1000, 1600, 23);
      ctx.fillStyle = rampColor(RAMP.flame, m.t);
      ctx.globalAlpha = 0.9 * Math.sin(Math.PI * m.t) * v.alpha;
      const s = Math.max(1, 0.03 * T * (1 - m.t * 0.5));
      ctx.fillRect((m.x + Math.sin(now / 300 + i) * 0.08) * T - s / 2, (m.y + 0.3 - 0.9 * m.t) * T - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawBulwark(f: GfxFrame, v: View): void {
    const { ctx, T } = f;
    let rise = 1;
    if (v.act >= 0 && !f.motion.reduced) rise = Math.max(0, easeOutBack(v.act / 0.6));
    const r = DOME_R * T * rise * v.scale;
    if (r < 1) return;
    const x = v.cx * T;
    const y = v.cy * T;
    ctx.globalAlpha = v.alpha;
    ctx.strokeStyle = 'rgba(240,215,160,0.85)';
    ctx.lineWidth = Math.max(2, T / 22);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,215,160,0.22)';
    ctx.lineWidth = Math.max(1, T / 40);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.93, 0, Math.PI * 2);
    ctx.stroke();
    // Top-left highlight arc.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,248,225,0.6)';
    ctx.lineWidth = Math.max(2, T / 14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.965, Math.PI * 1.08, Math.PI * 1.42);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawSanctuary(f: GfxFrame, v: View, motes: number): void {
    const { ctx, T } = f;
    const now = f.now;
    const reduced = f.motion.reduced;
    const path = v.geom.path;
    if (raySprite && path) {
      ctx.save();
      const scaled = v.scale !== 1;
      if (scaled) {
        ctx.translate(v.cx * T, v.cy * T);
        ctx.scale(v.scale, v.scale);
        ctx.translate(-v.cx * T, -v.cy * T);
      }
      ctx.clip(path, 'evenodd');
      ctx.globalCompositeOperation = 'lighter';
      const pulse = reduced ? 0.2 : 0.2 + 0.05 * Math.sin((now / 2400) * Math.PI * 2);
      ctx.globalAlpha = pulse * v.alpha;
      ctx.translate(v.cx * T, v.cy * T);
      if (!reduced) ctx.rotate(((now % 20000) / 20000) * Math.PI * 2);
      ctx.drawImage(raySprite as CanvasImageSource, -raySprite.width / 2, -raySprite.height / 2);
      ctx.restore();
    }
    // Activation: warm white flash over the tiles (0.5 -> 0, ~600 ms).
    if (v.act >= 0 && path) {
      const q = clamp01((v.act * v.actDur) / Math.min(600, v.actDur * 0.8 || 600));
      if (q < 1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5 * (1 - q);
        ctx.fillStyle = 'rgb(255,248,220)';
        ctx.fill(path, 'evenodd');
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#fff6c8';
    for (let i = 0; i < motes; i++) {
      const m = mote(v, i, now, 2200, 3200, 31);
      ctx.globalAlpha = 0.8 * Math.sin(Math.PI * m.t) * v.alpha;
      const s = Math.max(1.5, 0.035 * T);
      ctx.beginPath();
      ctx.arc((m.x + Math.sin(now / 700 + i) * 0.06) * T, (m.y + 0.2 - 0.6 * m.t) * T, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawSilence(f: GfxFrame, v: View, motes: number): void {
    const { ctx, T } = f;
    const now = f.now;
    const reduced = f.motion.reduced;
    const x = v.cx * T;
    const y = v.cy * T;
    ctx.strokeStyle = '#b9a6e0';
    ctx.lineWidth = Math.max(1, T / 30);
    for (let k = 0; k < 2; k++) {
      const ph = reduced ? 0.35 + 0.3 * k : ((now / 1600 + k * 0.5) % 1 + 1) % 1;
      ctx.globalAlpha = (reduced ? 0.25 : 0.45 * Math.sin(Math.PI * ph)) * v.alpha;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, DOME_R * T * (1 - ph) * v.scale), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (v.act >= 0) {
      const q = clamp01(v.act);
      ctx.globalAlpha = 0.7 * (1 - q);
      ctx.lineWidth = Math.max(2, T / 10);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, DOME_R * T * (1 - easeOutCubic(q))), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#b9a6e0';
    for (let i = 0; i < motes; i++) {
      const m = mote(v, i, now, 1800, 2600, 41);
      const mx = m.x + (v.cx - m.x) * 0.7 * m.t;
      const my = m.y + (v.cy - m.y) * 0.7 * m.t;
      ctx.globalAlpha = 0.6 * Math.sin(Math.PI * m.t) * v.alpha;
      const s = Math.max(1, 0.03 * T);
      ctx.fillRect(mx * T - s / 2, my * T - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  return {
    reset() {
      for (const tr of tracked.values()) tr.geom = null;
      glows.clear();
      spriteT = 0;
      hexSprite = null;
      raySprite = null;
      bandSprite = null;
      frameStamp = -1;
    },
    clear() {
      tracked.clear();
      views.length = 0;
      frameStamp = -1;
    },
    drawGround(f: GfxFrame) {
      buildViews(f);
      if (views.length === 0) return;
      ensureSprites(f.T);
      // Ambient bolt timers (dt-based: they pause with the frame loop).
      const amb = ambientAllowed(f.motion);
      for (const v of views) {
        if (v.kind !== 'tempest') continue;
        const tr = v.tr;
        tr.boltAge += f.dt;
        if (!amb || v.act >= 0 || v.end >= 0) continue;
        tr.boltAcc += f.dt;
        if (tr.boltAcc >= tr.boltNext) {
          tr.boltAcc = 0;
          tr.boltCount++;
          tr.boltNext = 900 + 700 * hash(tr.boltCount, 3, hashString(v.id));
          const tile = v.tiles[Math.floor(hash(tr.boltCount, 4, hashString(v.id)) * v.tiles.length)];
          if (tile) {
            tr.boltX = tile.x + 0.5;
            tr.boltY = tile.y + 0.82;
            tr.boltAge = 0;
          }
        }
      }
      for (const v of views) drawGroundOne(f, v);
    },
    collectLights(f: GfxFrame) {
      buildViews(f);
      lightUsed = 0;
      for (const v of views) {
        const look = DOMAIN[v.kind];
        const k = v.light * v.alpha;
        const seed = hashString(v.id);
        if (v.kind === 'silence') light(f, v.cx, v.cy, 4, 0.15 * k, look.light, 0, seed, true);
        else light(f, v.cx, v.cy, 4, 0.6 * k, look.light, v.kind === 'pyre' ? 0.15 : 0.04, seed);
        if (v.kind === 'tempest') {
          const tr = v.tr;
          if (tr.boltAge < 260) light(f, tr.boltX, tr.boltY - 0.3, 1.5, 0.8 * (1 - tr.boltAge / 260), [143, 216, 255], 0, 0);
          if (v.act >= 0 && !f.motion.reduced) {
            for (let b = 0; b < 3; b++) {
              const q = (v.act - (0.1 + 0.3 * b)) / 0.2;
              if (q < 0 || q >= 1) continue;
              const tile = v.tiles[Math.floor(hash(b, 5, seed) * v.tiles.length)];
              if (tile) light(f, tile.x + 0.5, tile.y + 0.5, 1.5, 0.8 * (1 - q), [143, 216, 255], 0, 0);
            }
          }
        }
      }
    },
    drawUpper(f: GfxFrame) {
      buildViews(f);
      if (views.length === 0) return;
      // Share the Domain ambient budget (6.5) between the active Domains.
      let want = 0;
      const amb = ambientAllowed(f.motion);
      if (amb) for (const v of views) want += AMBIENT_WANT[v.kind];
      const scale = want > DOMAIN_AMBIENT_SHARE ? DOMAIN_AMBIENT_SHARE / want : 1;
      for (const v of views) {
        const motes = amb && v.end < 0 ? Math.floor(AMBIENT_WANT[v.kind] * scale) : 0;
        switch (v.kind) {
          case 'tempest':
            drawTempest(f, v, motes);
            break;
          case 'pyre':
            drawPyre(f, v, motes);
            break;
          case 'bulwark':
            drawBulwark(f, v);
            break;
          case 'sanctuary':
            drawSanctuary(f, v, motes);
            break;
          case 'silence':
            drawSilence(f, v, motes);
            break;
        }
      }
    },
  };
}

// --- cached sprites -------------------------------------------------------------------------------

/** Hex lattice (hex size 0.6T) covering the dome, rgba(236,217,168,0.22). */
function buildHexSprite(T: number): HTMLCanvasElement | OffscreenCanvas | null {
  const size = Math.ceil((DOME_R * 2 + 1.2) * T);
  const c = makeCanvas(size, size);
  const g = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!c || !g) return null;
  const r = 0.6 * T;
  const w = Math.sqrt(3) * r;
  g.strokeStyle = 'rgba(236,217,168,0.22)';
  g.lineWidth = Math.max(1, T / 34);
  g.beginPath();
  const mid = size / 2;
  for (let row = -8; row <= 8; row++) {
    for (let col = -8; col <= 8; col++) {
      const cx = mid + col * w + (row & 1 ? w / 2 : 0);
      const cy = mid + row * r * 1.5;
      if (cx < -w || cy < -r * 2 || cx > size + w || cy > size + r * 2) continue;
      for (let k = 0; k < 6; k++) {
        const a0 = Math.PI / 6 + (k * Math.PI) / 3;
        const a1 = a0 + Math.PI / 3;
        g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
        g.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
      }
    }
  }
  g.stroke();
  return c;
}

/** 12 soft sun rays from the centre, fading outward (Sanctuary). */
function buildRaySprite(T: number): HTMLCanvasElement | OffscreenCanvas | null {
  const R = (DOME_R + 0.8) * T;
  const size = Math.ceil(R * 2);
  const c = makeCanvas(size, size);
  const g = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!c || !g) return null;
  const mid = size / 2;
  const grad = g.createRadialGradient(mid, mid, 0, mid, mid, R);
  grad.addColorStop(0, 'rgba(255,246,210,1)');
  grad.addColorStop(0.5, 'rgba(255,240,190,0.55)');
  grad.addColorStop(1, 'rgba(255,240,190,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const hw = 0.075;
    g.moveTo(mid, mid);
    g.lineTo(mid + Math.cos(a - hw) * R, mid + Math.sin(a - hw) * R);
    g.lineTo(mid + Math.cos(a + hw) * R, mid + Math.sin(a + hw) * R);
    g.closePath();
  }
  g.fill();
  return c;
}

/** Soft vertical band (Bulwark shimmer). */
function buildBandSprite(T: number): HTMLCanvasElement | OffscreenCanvas | null {
  const w = Math.ceil(1.2 * T);
  const h = Math.ceil((DOME_R * 2 + 3) * T);
  const c = makeCanvas(w, h);
  const g = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (!c || !g) return null;
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(255,240,200,0)');
  grad.addColorStop(0.5, 'rgba(255,240,200,0.22)');
  grad.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  return c;
}
