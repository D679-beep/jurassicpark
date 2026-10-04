// Highlights, hover path, hovered-zone outline (layer 8), zone plaques
// (layer 9), Domain labels and object HP badges (layer 12) and the hover
// tile outline (layer 13). Spec: visual-style.md 1.5, 4.9, 2.
// Owner: WS2 (Lighting & overlays). WS0 STUB: the pre-overhaul overlay code,
// moved here unchanged from renderer.ts (object HP numbers used to be drawn
// with the objects; they now sit in layer 12 as the spec orders). WS2
// restyles per 1.5 / 4.9 (plaques, casing, zone outline on hover, text
// width cache keyed by T).
import { posKey, type GameState, type Pos, type Terrain } from '../../engine';
import { placeZoneLabel } from '../layout';
import { DOMAIN_NAMES, zoneName } from '../names';
import { COLORS, DOMAIN_STYLE, hpColor } from '../palette';
import type { GfxFrame, OverlaysPass } from './types';

/** Terrain a zone plaque should not cover (furniture and cover). */
const LABEL_BLOCKING: ReadonlySet<Terrain> = new Set<Terrain>(['pillar', 'table', 'crates', 'brazier', 'bell']);

export function createOverlays(): OverlaysPass {
  return {
    reset() {},
    clear() {},
    drawHighlights(f: GfxFrame) {
      const { input } = f;
      if (!input.showHighlights || input.selection.mode !== 'unit') return;
      for (const m of input.selection.moves) tileFill(f, m, COLORS.reach, COLORS.reachEdge);
      for (const t of input.selection.targets) tileFill(f, t.pos, COLORS.target, COLORS.targetEdge);
      if (input.hoverPath && input.hoverPath.length > 0) drawPath(f, input.hoverPath);
    },
    drawZoneLabels(f: GfxFrame) {
      drawZoneLabels(f);
    },
    drawTopLabels(f: GfxFrame) {
      drawDomainLabels(f);
      drawObjectHp(f);
    },
    drawHover(f: GfxFrame) {
      const { ctx, T } = f;
      const h = f.input.hover;
      if (!h) return;
      ctx.strokeStyle = COLORS.hover;
      ctx.lineWidth = Math.max(1, Math.round(T / 16));
      ctx.strokeRect(h.x * T + 0.5, h.y * T + 0.5, T - 1, T - 1);
    },
  };
}

function tileFill(f: GfxFrame, p: Pos, fill: string, edge: string): void {
  const { ctx, T } = f;
  ctx.fillStyle = fill;
  ctx.fillRect(p.x * T, p.y * T, T, T);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, Math.round(T / 20));
  const inset = ctx.lineWidth / 2 + 1;
  ctx.strokeRect(p.x * T + inset, p.y * T + inset, T - 2 * inset, T - 2 * inset);
}

function drawPath(f: GfxFrame, path: Pos[]): void {
  const { ctx, T } = f;
  ctx.fillStyle = COLORS.path;
  for (const p of path) {
    ctx.beginPath();
    ctx.arc((p.x + 0.5) * T, (p.y + 0.5) * T, Math.max(1.5, T * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }
}

function terrainAtXY(state: GameState, x: number, y: number): Terrain | undefined {
  return state.map.terrain[y]?.[x];
}

/**
 * Zone names, placed each frame on a run of tiles free of units, objects
 * and exits so a unit standing in the corner does not hide the label.
 */
function drawZoneLabels(f: GfxFrame): void {
  const { ctx, state, T } = f;
  const minFont = f.px(10);
  if (T < minFont) return;
  const fs = Math.max(minFont, Math.round(T * 0.3));
  const pad = Math.max(2, Math.round(fs * 0.25));
  const blocked = new Set<string>();
  for (const du of f.units) {
    if (du.ghost) continue;
    blocked.add(`${Math.round(du.pos.x)},${Math.round(du.pos.y)}`);
  }
  for (const o of state.map.objects) {
    if (o.kind === 'bridge' || o.kind === 'gate') {
      if (o.kind === 'gate') for (const t of o.tiles) blocked.add(posKey(t));
      continue;
    }
    blocked.add(posKey(o.pos));
  }
  for (const e of state.map.exits) for (const p of e.tiles) blocked.add(posKey(p));
  ctx.font = `600 ${fs}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const [id, tiles] of Object.entries(state.map.zones)) {
    const label = zoneName(id).toUpperCase();
    const w = Math.ceil(ctx.measureText(label).width) + 2 * pad;
    const at = placeZoneLabel(tiles, Math.ceil((w + pad) / T), (q) => {
      const t = terrainAtXY(state, q.x, q.y);
      return blocked.has(posKey(q)) || (t !== undefined && LABEL_BLOCKING.has(t));
    });
    if (!at) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(at.x * T + pad, at.y * T + pad, w, fs + pad);
    ctx.fillStyle = COLORS.zoneLabel;
    ctx.fillText(label, at.x * T + 2 * pad, at.y * T + pad + Math.round(pad / 2));
  }
}

function drawDomainLabels(f: GfxFrame): void {
  const { ctx, T } = f;
  if (T < f.px(12)) return;
  for (const dd of f.domains) {
    // Label inside the diamond's bottom tip, drawn over units so it stays legible.
    const bottom = dd.tiles.reduce<Pos | null>((m, p) => (m === null || p.y > m.y ? p : m), null);
    if (!bottom) continue;
    const fs = Math.max(f.px(10), Math.round(T * 0.32));
    ctx.font = `700 ${fs}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const label = DOMAIN_NAMES[dd.domain.kind].toUpperCase();
    const pad = Math.round(fs * 0.35);
    const w = ctx.measureText(label).width + 2 * pad;
    const cx = (bottom.x + 0.5) * T;
    const y = (bottom.y + 1) * T - Math.round(fs * 0.15);
    ctx.fillStyle = 'rgba(8,7,12,0.82)';
    ctx.fillRect(Math.round(cx - w / 2), y - fs - pad / 2, Math.round(w), fs + pad);
    ctx.fillStyle = DOMAIN_STYLE[dd.domain.kind].label;
    ctx.fillText(label, cx, y);
  }
}

/** HP numbers on intact barred doors and ward anchors. */
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
  if (T < f.px(14)) {
    hpBar(f, p.x * T + T * 0.12, p.y * T + T * 0.86, T * 0.76, hp, maxHp);
    return;
  }
  const fs = Math.max(f.px(10), Math.round(T * 0.32));
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const text = `${hp}`;
  const w = ctx.measureText(text).width + fs * 0.5;
  const bx = (p.x + 0.5) * T - w / 2;
  const by = (p.y + 1) * T - fs - 1;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(bx, by, w, fs + 1);
  ctx.fillStyle = hpColor(maxHp > 0 ? hp / maxHp : 0);
  ctx.fillText(text, (p.x + 0.5) * T, (p.y + 1) * T);
}

function hpBar(f: GfxFrame, x: number, y: number, w: number, hp: number, maxHp: number): void {
  const { ctx, T } = f;
  const h = Math.max(2, Math.round(T * 0.1));
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  ctx.fillStyle = COLORS.hpBack;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, Math.round(w) + 2, h + 2);
  ctx.fillStyle = hpColor(ratio);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w * ratio), h);
}
