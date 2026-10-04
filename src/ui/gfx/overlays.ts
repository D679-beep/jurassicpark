// Highlights, hover path, hovered-zone outline (layer 8), zone plaques
// (layer 9), Domain labels and object HP badges (layer 12) and the hover
// tile outline (layer 13). Spec: visual-style.md 1.5, 4.9, 2, 8.
// Owner: WS2 (Lighting & overlays).
//
// Everything here is drawn above the darkness and never shaded. Every
// outline has a dark casing so it reads on the darkest tunnel stone and on
// the brightest lit floor alike. Plaques (zone and Domain labels) are
// pre-rendered sprites keyed by T/dpr; zone label placement is recomputed
// only when the tiles it must avoid change.
import { type DomainKind, type GameState, type Pos, type Terrain } from '../../engine';
import { placeZoneLabel } from '../layout';
import { DOMAIN_NAMES, zoneName } from '../names';
import { DOMAIN, OVERLAY, hpColor } from '../palette';
import type { GfxFrame, MapSites, OverlaysPass } from './types';

/** Terrain a zone plaque should not cover (furniture and cover). */
const LABEL_BLOCKING: ReadonlySet<Terrain> = new Set<Terrain>(['pillar', 'table', 'crates', 'brazier', 'bell']);

/** Per-tile inner grid line of the reach area (separates it from Domain fills, which have none). */
const REACH_GRID = 'rgba(150,200,255,0.38)';
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";

// --- pure helpers (unit-tested) -------------------------------------------------

/** Bit flags of a tile's region edges: 1 = N, 2 = E, 4 = S, 8 = W (neighbour outside the set). */
export function edgeMask(x: number, y: number, inside: (x: number, y: number) => boolean): number {
  let m = 0;
  if (!inside(x, y - 1)) m |= 1;
  if (!inside(x + 1, y)) m |= 2;
  if (!inside(x, y + 1)) m |= 4;
  if (!inside(x - 1, y)) m |= 8;
  return m;
}

/** Zone/Domain plaque font size in device px: at least 10 css px (checklist 10). */
export function labelFont(T: number, dpr: number, frac = 0.3): number {
  return Math.max(Math.round(10 * dpr), Math.round(T * frac));
}

/** The tile of a Domain label: bottom tip of the diamond (largest y, then the middle x). */
export function domainLabelTile(tiles: readonly Pos[]): Pos | null {
  let best: Pos | null = null;
  for (const p of tiles) if (!best || p.y > best.y) best = p;
  return best;
}

// --- sprites ------------------------------------------------------------------------

interface Plaque {
  c: HTMLCanvasElement;
  /** Logical size (device px). */
  w: number;
  h: number;
}

function makePlaque(text: string, font: string, fs: number, color: string, edge: string, dpr: number): Plaque {
  const pad = Math.max(2, Math.round(fs * 0.35));
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const tw = Math.ceil(probe.measureText(text).width);
  const w = tw + 2 * pad;
  const h = fs + pad;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const lw = Math.max(1, Math.round(dpr));
  g.fillStyle = OVERLAY.plate;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = edge;
  g.lineWidth = lw;
  g.strokeRect(lw / 2, lw / 2, w - lw, h - lw);
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2 + Math.round(fs * 0.04));
  return { c, w, h };
}

// --- the pass -----------------------------------------------------------------------

export function createOverlays(): OverlaysPass {
  // Size-keyed caches (reset()).
  let cacheT = 0;
  let cacheDpr = 0;
  const zonePlaques = new Map<string, Plaque>();
  const domainPlaques = new Map<DomainKind, Plaque>();
  let dashZone: number[] = [];

  // Zone-label placement memo.
  let placeSig = -1;
  let placeT = 0;
  let placeState: GameState | null = null;
  const placements = new Map<string, Pos | null>();
  let blocked = new Uint8Array(0);

  // Membership grids for the reach/target regions (stamped, no clearing).
  let reachAt = new Uint32Array(0);
  let targetAt = new Uint32Array(0);
  let gen = 0;

  const ensureSize = (f: GfxFrame): void => {
    if (cacheT === f.T && cacheDpr === f.dpr) return;
    cacheT = f.T;
    cacheDpr = f.dpr;
    zonePlaques.clear();
    domainPlaques.clear();
    dashZone = [Math.max(2, Math.round(f.T / 6)), Math.max(2, Math.round(f.T / 9))];
    placeSig = -1;
  };

  const ensureGrids = (n: number): void => {
    if (reachAt.length >= n) return;
    reachAt = new Uint32Array(n);
    targetAt = new Uint32Array(n);
    blocked = new Uint8Array(n);
  };

  const zonePlaque = (f: GfxFrame, id: string): Plaque => {
    let p = zonePlaques.get(id);
    if (!p) {
      const fs = labelFont(f.T, f.dpr, 0.3);
      p = makePlaque(zoneName(id).toUpperCase(), `600 ${fs}px ${SERIF}`, fs, OVERLAY.zoneLabel, OVERLAY.plateEdge, f.dpr);
      zonePlaques.set(id, p);
    }
    return p;
  };

  const domainPlaque = (f: GfxFrame, kind: DomainKind): Plaque => {
    let p = domainPlaques.get(kind);
    if (!p) {
      const fs = labelFont(f.T, f.dpr, 0.3);
      const look = DOMAIN[kind];
      p = makePlaque(DOMAIN_NAMES[kind].toUpperCase(), `700 ${fs}px ${SERIF}`, fs, look.label, look.edge, f.dpr);
      domainPlaques.set(kind, p);
    }
    return p;
  };

  return {
    reset() {
      cacheT = 0;
      cacheDpr = 0;
      zonePlaques.clear();
      domainPlaques.clear();
      placeSig = -1;
      placeState = null;
      placements.clear();
    },
    clear() {
      placeSig = -1;
      placeState = null;
      placements.clear();
    },

    drawHighlights(f: GfxFrame) {
      ensureSize(f);
      drawZoneOutline(f, dashZone);
      const { input } = f;
      const sel = input.selection;
      if (!input.showHighlights || sel.mode !== 'unit') return;
      const w = f.mapW;
      ensureGrids(w * f.mapH);
      gen = (gen + 1) >>> 0 || 1;
      for (const m of sel.moves) if (m.x >= 0 && m.y >= 0 && m.x < w && m.y < f.mapH) reachAt[m.y * w + m.x] = gen;
      for (const t of sel.targets) if (t.pos.x >= 0 && t.pos.y >= 0 && t.pos.x < w && t.pos.y < f.mapH) targetAt[t.pos.y * w + t.pos.x] = gen;
      const g = gen;
      const inReach = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < f.mapH && reachAt[y * w + x] === g;
      const inTarget = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < f.mapH && targetAt[y * w + x] === g;
      drawRegion(f, sel.moves, inReach, OVERLAY.reach, OVERLAY.reachEdge, REACH_GRID);
      const targets = sel.targets;
      if (targets.length > 0) {
        const { ctx, T } = f;
        ctx.fillStyle = OVERLAY.target;
        for (const t of targets) ctx.fillRect(t.pos.x * T, t.pos.y * T, T, T);
        regionEdges(f, targets, (t) => t.pos, inTarget, OVERLAY.targetEdge);
        for (const t of targets) reticle(f, t.pos);
      }
      if (input.hoverPath && input.hoverPath.length > 0) {
        const u = f.state.units.find((x) => x.id === sel.unitId);
        drawPath(f, u ? f.displayPos(u) : null, input.hoverPath);
      }
    },

    drawZoneLabels(f: GfxFrame) {
      ensureSize(f);
      const { ctx, state, T } = f;
      if (T < f.px(14)) return;
      const n = f.mapW * f.mapH;
      ensureGrids(n);
      // Signature of everything a plaque must avoid: units, objects, exits.
      let sig = 7;
      for (const du of f.units) {
        if (du.ghost) continue;
        sig = (Math.imul(sig, 31) + Math.round(du.pos.y) * 1024 + Math.round(du.pos.x)) | 0;
      }
      if (sig !== placeSig || placeT !== T || placeState?.map !== state.map) {
        placeSig = sig;
        placeT = T;
        placeState = state;
        computePlacements(f, blocked, placements, (id) => zonePlaque(f, id).w);
      }
      const pad = Math.max(2, Math.round(T * 0.08));
      for (const [id, at] of placements) {
        if (!at) continue;
        const p = zonePlaque(f, id);
        ctx.drawImage(p.c, at.x * T + pad, at.y * T + pad);
      }
    },

    drawTopLabels(f: GfxFrame) {
      ensureSize(f);
      const { ctx, T } = f;
      if (T >= f.px(14)) {
        for (const dd of f.domains) {
          const tip = domainLabelTile(dd.tiles);
          if (!tip) continue;
          const p = domainPlaque(f, dd.domain.kind);
          const x = Math.round((tip.x + 0.5) * T - p.w / 2);
          const y = Math.round((tip.y + 1) * T - p.h - Math.max(1, Math.round(T * 0.04)));
          ctx.drawImage(p.c, x, y);
        }
      }
      drawObjectHp(f);
    },

    drawHover(f: GfxFrame) {
      const { ctx, T } = f;
      const h = f.input.hover;
      if (!h) return;
      const lw = Math.max(1, Math.round(T / 16));
      const o = f.px(1);
      // Dark casing outside, white line inside: reads on any tile.
      ctx.strokeStyle = OVERLAY.edgeOuter;
      ctx.lineWidth = lw + 2 * o;
      ctx.strokeRect(h.x * T + lw / 2 + o / 2, h.y * T + lw / 2 + o / 2, T - lw - o, T - lw - o);
      ctx.strokeStyle = OVERLAY.hover;
      ctx.lineWidth = lw;
      ctx.strokeRect(h.x * T + lw / 2 + o, h.y * T + lw / 2 + o, T - lw - 2 * o, T - lw - 2 * o);
    },
  };
}

// --- highlights -----------------------------------------------------------------------

/** Reach area: fill, a faint per-tile grid (counting tiles), and a cased outer outline. */
function drawRegion(
  f: GfxFrame,
  tiles: readonly Pos[],
  inside: (x: number, y: number) => boolean,
  fill: string,
  edge: string,
  grid: string,
): void {
  if (tiles.length === 0) return;
  const { ctx, T } = f;
  ctx.fillStyle = fill;
  for (const p of tiles) ctx.fillRect(p.x * T, p.y * T, T, T);
  // Inner grid: one line on each shared edge (N and W of interior neighbours).
  ctx.strokeStyle = grid;
  ctx.lineWidth = Math.max(1, f.px(1));
  ctx.beginPath();
  const half = ctx.lineWidth / 2;
  for (const p of tiles) {
    if (inside(p.x, p.y - 1)) {
      ctx.moveTo(p.x * T, p.y * T + half);
      ctx.lineTo((p.x + 1) * T, p.y * T + half);
    }
    if (inside(p.x - 1, p.y)) {
      ctx.moveTo(p.x * T + half, p.y * T);
      ctx.lineTo(p.x * T + half, (p.y + 1) * T);
    }
  }
  ctx.stroke();
  regionEdges(f, tiles, (p) => p, inside, edge);
}

/** Outer outline of a tile set: dark casing then the bright edge, inset so it stays inside the tiles. */
function regionEdges<P>(f: GfxFrame, items: readonly P[], posOf: (p: P) => Pos, inside: (x: number, y: number) => boolean, edge: string): void {
  const { ctx, T } = f;
  const lw = Math.max(f.px(1.5), Math.round(T / 20));
  const o = Math.max(1, f.px(1));
  for (let pass = 0; pass < 2; pass++) {
    // Casing: wider, centred a little further out; edge: on top, inset by half its width.
    const width = pass === 0 ? lw + 2 * o : lw;
    const inset = pass === 0 ? (lw + 2 * o) / 2 : lw / 2 + o;
    ctx.strokeStyle = pass === 0 ? OVERLAY.edgeOuter : edge;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const it of items) {
      const p = posOf(it);
      const m = edgeMask(p.x, p.y, inside);
      if (m === 0) continue;
      const x0 = p.x * T;
      const y0 = p.y * T;
      const x1 = x0 + T;
      const y1 = y0 + T;
      // Extend along the edge into an outlined neighbour so corners close.
      const ax0 = m & 8 ? x0 + inset : x0;
      const ax1 = m & 2 ? x1 - inset : x1;
      const ay0 = m & 1 ? y0 + inset : y0;
      const ay1 = m & 4 ? y1 - inset : y1;
      if (m & 1) {
        ctx.moveTo(ax0, y0 + inset);
        ctx.lineTo(ax1, y0 + inset);
      }
      if (m & 4) {
        ctx.moveTo(ax0, y1 - inset);
        ctx.lineTo(ax1, y1 - inset);
      }
      if (m & 8) {
        ctx.moveTo(x0 + inset, ay0);
        ctx.lineTo(x0 + inset, ay1);
      }
      if (m & 2) {
        ctx.moveTo(x1 - inset, ay0);
        ctx.lineTo(x1 - inset, ay1);
      }
    }
    ctx.lineCap = 'square';
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Attack reticle: four corner brackets, cased, so a target reads as "attack" not "move". */
function reticle(f: GfxFrame, p: Pos): void {
  const { ctx, T } = f;
  const len = T * 0.24;
  const i = Math.max(2, Math.round(T * 0.1));
  const lw = Math.max(f.px(1.5), Math.round(T / 16));
  const x0 = p.x * T + i;
  const y0 = p.y * T + i;
  const x1 = (p.x + 1) * T - i;
  const y1 = (p.y + 1) * T - i;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + len);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + len, y0);
  ctx.moveTo(x1 - len, y0);
  ctx.lineTo(x1, y0);
  ctx.lineTo(x1, y0 + len);
  ctx.moveTo(x1, y1 - len);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - len, y1);
  ctx.moveTo(x0 + len, y1);
  ctx.lineTo(x0, y1);
  ctx.lineTo(x0, y1 - len);
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = OVERLAY.edgeOuter;
  ctx.lineWidth = lw + 2 * f.px(1);
  ctx.stroke();
  ctx.strokeStyle = OVERLAY.targetEdge;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** Hover path: cased polyline from the unit to the destination, with an end ring. */
function drawPath(f: GfxFrame, from: Pos | null, path: readonly Pos[]): void {
  const { ctx, T } = f;
  const lw = Math.max(f.px(2), Math.round(T / 11));
  const casing = lw + 2 * Math.max(1, f.px(1.5));
  const last = path[path.length - 1]!;
  const ex = (last.x + 0.5) * T;
  const ey = (last.y + 0.5) * T;
  const rr = T * 0.17;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (from) ctx.moveTo((from.x + 0.5) * T, (from.y + 0.5) * T);
  else ctx.moveTo((path[0]!.x + 0.5) * T, (path[0]!.y + 0.5) * T);
  for (const p of path) ctx.lineTo((p.x + 0.5) * T, (p.y + 0.5) * T);
  ctx.strokeStyle = OVERLAY.pathCasing;
  ctx.lineWidth = casing;
  ctx.stroke();
  ctx.strokeStyle = OVERLAY.path;
  ctx.lineWidth = lw;
  ctx.stroke();
  // Destination: a cased ring and a dot (the line stops at the ring's centre).
  ctx.beginPath();
  ctx.arc(ex, ey, rr, 0, Math.PI * 2);
  ctx.strokeStyle = OVERLAY.pathCasing;
  ctx.lineWidth = casing;
  ctx.stroke();
  ctx.strokeStyle = OVERLAY.path;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

/** Dashed outline of the hovered tile's zone (4.9), from sites.zone (no coordinates). */
function drawZoneOutline(f: GfxFrame, dash: number[]): void {
  const h = f.input.hover;
  if (!h) return;
  const s: MapSites = f.sites;
  const id = s.zone[h.y]?.[h.x];
  if (!id) return;
  const box = s.zoneBoxes[id];
  if (!box) return;
  const { ctx, T } = f;
  const inside = (x: number, y: number): boolean => s.zone[y]?.[x] === id;
  const lw = Math.max(1, Math.round(T / 24));
  const half = lw / 2;
  ctx.beginPath();
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (!inside(x, y)) continue;
      const m = edgeMask(x, y, inside);
      if (m & 1) {
        ctx.moveTo(x * T, y * T + half);
        ctx.lineTo((x + 1) * T, y * T + half);
      }
      if (m & 4) {
        ctx.moveTo(x * T, (y + 1) * T - half);
        ctx.lineTo((x + 1) * T, (y + 1) * T - half);
      }
      if (m & 8) {
        ctx.moveTo(x * T + half, y * T);
        ctx.lineTo(x * T + half, (y + 1) * T);
      }
      if (m & 2) {
        ctx.moveTo((x + 1) * T - half, y * T);
        ctx.lineTo((x + 1) * T - half, (y + 1) * T);
      }
    }
  }
  ctx.setLineDash(dash);
  ctx.lineDashOffset = 0;
  // A faint dark under-stroke keeps the gold dashes legible on lit floors.
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = lw + 2;
  ctx.stroke();
  ctx.strokeStyle = OVERLAY.zoneOutline;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.setLineDash([]);
}

// --- zone labels ------------------------------------------------------------------------

/** Places each zone's plaque on a run of tiles free of units, objects, exits and furniture. */
function computePlacements(
  f: GfxFrame,
  blocked: Uint8Array,
  out: Map<string, Pos | null>,
  widthOf: (id: string) => number,
): void {
  const { state, T } = f;
  const w = f.mapW;
  blocked.fill(0, 0, w * f.mapH);
  const mark = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < w && y < f.mapH) blocked[y * w + x] = 1;
  };
  for (const du of f.units) if (!du.ghost) mark(Math.round(du.pos.x), Math.round(du.pos.y));
  for (const o of state.map.objects) {
    if (o.kind === 'bridge') continue;
    if (o.kind === 'gate') {
      for (const t of o.tiles) mark(t.x, t.y);
      continue;
    }
    mark(o.pos.x, o.pos.y);
  }
  for (const e of state.map.exits) for (const p of e.tiles) mark(p.x, p.y);
  out.clear();
  const pad = Math.max(2, Math.round(T * 0.08));
  for (const [id, tiles] of Object.entries(state.map.zones)) {
    const span = Math.ceil((widthOf(id) + 2 * pad) / T);
    const at = placeZoneLabel(tiles, span, (q) => {
      if (q.x < 0 || q.y < 0 || q.x >= w || q.y >= f.mapH) return true;
      const t = state.map.terrain[q.y]?.[q.x];
      return blocked[q.y * w + q.x] === 1 || (t !== undefined && LABEL_BLOCKING.has(t));
    });
    out.set(id, at);
  }
}

// --- object HP badges ---------------------------------------------------------------------

/** HP badges on intact barred doors and ward anchors (layer 12). */
function drawObjectHp(f: GfxFrame): void {
  for (const o of f.state.map.objects) {
    if (o.kind !== 'door' && o.kind !== 'anchor') continue;
    const destroyed = o.destroyed && !f.input.overrides.intactObjects[o.id];
    if (destroyed) continue;
    objectHp(f, o.pos, f.input.overrides.hp[o.id] ?? o.hp, o.maxHp);
  }
}

function objectHp(f: GfxFrame, p: Pos, hp: number, maxHp: number): void {
  const { ctx, T } = f;
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const col = hpColor(ratio);
  const fs = labelFont(T, f.dpr, 0.3);
  ctx.font = `700 ${fs}px ${SANS}`;
  const text = `${hp}`;
  const padX = Math.round(fs * 0.35);
  const barH = Math.max(f.px(2), Math.round(T * 0.05));
  const tw = Math.ceil(ctx.measureText(text).width);
  const w = Math.max(tw + 2 * padX, Math.round(T * 0.5));
  const h = fs + barH + Math.round(fs * 0.25);
  const x = Math.round((p.x + 0.5) * T - w / 2);
  const y = Math.round((p.y + 1) * T - h - Math.max(1, f.px(1)));
  const lw = Math.max(1, f.px(1));
  ctx.fillStyle = 'rgba(8,8,14,0.86)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(232,200,114,0.38)';
  ctx.lineWidth = lw;
  ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = col;
  ctx.fillText(text, x + w / 2, y + Math.round(fs * 0.12));
  // Mini bar along the bottom of the badge.
  const bx = x + lw + 1;
  const bw = w - 2 * (lw + 1);
  const by = y + h - barH - lw - 1;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(bx, by, bw, barH);
  ctx.fillStyle = col;
  ctx.fillRect(bx, by, Math.round(bw * ratio), barH);
}
