// Canvas 2D renderer. Draws in device pixels with an integer tile size so
// tile edges stay crisp at any devicePixelRatio. Terrain, zones and exits are
// cached in an offscreen canvas; units, objects, overlays and effects are
// drawn every frame.
import {
  RULES,
  diamondTiles,
  domainTiles,
  posEq,
  posKey,
  type ActiveDomain,
  type DomainKind,
  type GameState,
  type MapObject,
  type Pos,
  type Terrain,
  type Unit,
} from '../engine';
import type { AnimStep, DisplayOverrides } from './animation';
import { unitGlyph } from './hudModel';
import { lerpPath } from './layout';
import { DOMAIN_NAMES, zoneName } from './names';
import { COLORS, DOMAIN_STYLE, FACTION_STYLE, hpColor } from './palette';
import type { Selection } from './selection';

export type Effect =
  | { kind: 'float'; pos: Pos; text: string; color: string; start: number; life: number }
  | { kind: 'pulse'; center: Pos; radius: number; color: string; start: number; life: number }
  | { kind: 'flash'; tiles: Pos[]; color: string; start: number; life: number }
  | { kind: 'banner'; title: string; subtitle: string; color: string; start: number; life: number };

export interface RenderInput {
  state: GameState;
  overrides: DisplayOverrides;
  active: { step: AnimStep; progress: number } | null;
  selection: Selection;
  showHighlights: boolean;
  hover: Pos | null;
  hoverPath: Pos[] | null;
  effects: readonly Effect[];
  now: number;
}

const OUTDOOR_ZONES = new Set(['quay', 'innerGate', 'eastCourt']);

function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = '';
  /** Tile edge in device pixels. */
  tile = 16;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  /** Sizes the canvas for a CSS tile size at a device pixel ratio. */
  resize(cssTile: number, dpr: number, mapW: number, mapH: number): void {
    const tile = Math.max(4, Math.round(cssTile * (dpr > 0 ? dpr : 1)));
    this.tile = tile;
    const w = tile * mapW;
    const h = tile * mapH;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.canvas.style.width = `${w / dpr}px`;
    this.canvas.style.height = `${h / dpr}px`;
    this.cacheKey = '';
  }

  /** Converts a CSS-pixel offset inside the canvas to a tile. */
  tileAtClient(offsetX: number, offsetY: number, mapW: number, mapH: number): Pos | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const dx = (offsetX * this.canvas.width) / rect.width;
    const dy = (offsetY * this.canvas.height) / rect.height;
    const x = Math.floor(dx / this.tile);
    const y = Math.floor(dy / this.tile);
    if (x < 0 || y < 0 || x >= mapW || y >= mapH) return null;
    return { x, y };
  }

  /** Tile centre in CSS px relative to the canvas (for DOM tooltips). */
  tileCenterCss(p: Pos): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width / this.canvas.width;
    const sy = rect.height / this.canvas.height;
    return { x: (p.x + 0.5) * this.tile * sx, y: (p.y + 0.5) * this.tile * sy };
  }

  draw(input: RenderInput): void {
    const { ctx } = this;
    const { state } = input;
    const T = this.tile;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ensureCache(state, input.overrides);
    if (this.cache) ctx.drawImage(this.cache, 0, 0);

    for (const o of state.map.objects) this.drawObject(o, input);
    this.drawDomains(input);

    if (input.showHighlights && input.selection.mode === 'unit') {
      for (const m of input.selection.moves) this.tileFill(m, COLORS.reach, COLORS.reachEdge);
      for (const t of input.selection.targets) this.tileFill(t.pos, COLORS.target, COLORS.targetEdge);
      if (input.hoverPath && input.hoverPath.length > 0) this.drawPath(input.hoverPath);
    }

    this.drawUnits(input);
    this.drawDomainLabels(input);

    if (input.hover) {
      ctx.strokeStyle = COLORS.hover;
      ctx.lineWidth = Math.max(1, Math.round(T / 16));
      ctx.strokeRect(input.hover.x * T + 0.5, input.hover.y * T + 0.5, T - 1, T - 1);
    }

    this.drawEffects(input);
  }

  // --- terrain cache --------------------------------------------------------

  private ensureCache(state: GameState, ov: DisplayOverrides): void {
    const T = this.tile;
    const unburned = Object.values(ov.unburnedBridges).flat();
    const key = `${T}|${state.map.width}x${state.map.height}|${state.map.terrain.map((r) => r.join(',')).join(';')}|${unburned.map(posKey).join(' ')}`;
    if (this.cache && key === this.cacheKey) return;
    const c = this.cache ?? document.createElement('canvas');
    c.width = T * state.map.width;
    c.height = T * state.map.height;
    const g = c.getContext('2d');
    if (!g) return;
    const outdoor = new Set<string>();
    for (const z of OUTDOOR_ZONES) for (const p of state.map.zones[z] ?? []) outdoor.add(posKey(p));
    const burned = new Set<string>();
    for (const o of state.map.objects) if (o.kind === 'bridge' && o.burned) for (const t of o.tiles) burned.add(posKey(t));
    const unburnedKeys = new Set(unburned.map(posKey));

    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        let t = state.map.terrain[y]?.[x] ?? 'wall';
        const k = `${x},${y}`;
        if (unburnedKeys.has(k)) t = 'bridge';
        drawTerrain(g, state, x, y, T, t, outdoor.has(k), burned.has(k) && !unburnedKeys.has(k));
      }
    }
    drawLanterns(g, state, T);
    drawZones(g, state, T);
    drawExits(g, state, T);
    this.cache = c;
    this.cacheKey = key;
  }

  // --- overlays ---------------------------------------------------------------

  private tileFill(p: Pos, fill: string, edge: string): void {
    const { ctx } = this;
    const T = this.tile;
    ctx.fillStyle = fill;
    ctx.fillRect(p.x * T, p.y * T, T, T);
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(1, Math.round(T / 20));
    const inset = ctx.lineWidth / 2 + 1;
    ctx.strokeRect(p.x * T + inset, p.y * T + inset, T - 2 * inset, T - 2 * inset);
  }

  private drawPath(path: Pos[]): void {
    const { ctx } = this;
    const T = this.tile;
    ctx.fillStyle = COLORS.path;
    for (const p of path) {
      ctx.beginPath();
      ctx.arc((p.x + 0.5) * T, (p.y + 0.5) * T, Math.max(1.5, T * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private displayPos(u: Unit, input: RenderInput): Pos {
    const a = input.active;
    if (a && a.step.event.type === 'moved' && a.step.event.unitId === u.id) {
      return lerpPath(a.step.event.from, a.step.event.path, a.progress);
    }
    return input.overrides.pos[u.id] ?? u.pos;
  }

  private drawDomains(input: RenderInput): void {
    const { ctx } = this;
    const { state } = input;
    const T = this.tile;
    for (const d of state.domains) {
      if (input.overrides.hiddenDomains[d.ownerId]) continue;
      const owner = state.units.find((u) => u.id === d.ownerId);
      if (!owner) continue;
      const tiles = this.domainDisplayTiles(state, d, owner, input);
      const style = DOMAIN_STYLE[d.kind];
      const set = new Set(tiles.map(posKey));
      ctx.fillStyle = style.fill;
      for (const p of tiles) ctx.fillRect(p.x * T, p.y * T, T, T);
      drawDomainPattern(ctx, d.kind, tiles, T, input.now);
      ctx.strokeStyle = style.edge;
      ctx.lineWidth = Math.max(1, Math.round(T / 14));
      ctx.beginPath();
      for (const p of tiles) outlineEdges(ctx, p, T, (q) => set.has(posKey(q)));
      ctx.stroke();
    }
  }

  private drawDomainLabels(input: RenderInput): void {
    const { ctx } = this;
    const T = this.tile;
    if (T < 12) return;
    for (const d of input.state.domains) {
      if (input.overrides.hiddenDomains[d.ownerId]) continue;
      const owner = input.state.units.find((u) => u.id === d.ownerId);
      if (!owner) continue;
      const tiles = this.domainDisplayTiles(input.state, d, owner, input);
      // Label inside the diamond's bottom tip, drawn over units so it stays legible.
      const bottom = tiles.reduce<Pos | null>((m, p) => (m === null || p.y > m.y ? p : m), null);
      if (!bottom) continue;
      const fs = Math.max(9, Math.round(T * 0.32));
      ctx.font = `700 ${fs}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label = DOMAIN_NAMES[d.kind].toUpperCase();
      const w = ctx.measureText(label).width + 8;
      const cx = (bottom.x + 0.5) * T;
      const y = (bottom.y + 1) * T - 2;
      ctx.fillStyle = 'rgba(8,7,12,0.8)';
      ctx.fillRect(cx - w / 2, y - fs - 2, w, fs + 3);
      ctx.fillStyle = DOMAIN_STYLE[d.kind].label;
      ctx.fillText(label, cx, y);
    }
  }

  private domainDisplayTiles(state: GameState, d: ActiveDomain, owner: Unit, input: RenderInput): Pos[] {
    const shown = this.displayPos(owner, input);
    if (posEq(shown, owner.pos)) return domainTiles(state, d);
    const c = { x: Math.round(shown.x), y: Math.round(shown.y) };
    return diamondTiles(c, RULES.domainRadius, state.map.width, state.map.height);
  }

  // --- objects ----------------------------------------------------------------

  private drawObject(o: MapObject, input: RenderInput): void {
    if (o.kind === 'bridge') return; // drawn as terrain
    const { ctx } = this;
    const T = this.tile;
    const destroyed = o.destroyed && !input.overrides.intactObjects[o.id];
    const hp = input.overrides.hp[o.id] ?? o.hp;
    const x0 = o.pos.x * T;
    const y0 = o.pos.y * T;
    if (o.kind === 'door') {
      if (destroyed) {
        ctx.fillStyle = COLORS.doorWoodDark;
        for (let i = 0; i < 3; i++) {
          const h = hash(o.pos.x, o.pos.y, i);
          ctx.fillRect(x0 + T * (0.15 + h * 0.6), y0 + T * (0.2 + i * 0.25), T * 0.22, T * 0.08);
        }
        return;
      }
      ctx.fillStyle = COLORS.doorWood;
      ctx.fillRect(x0 + T * 0.1, y0 + T * 0.1, T * 0.8, T * 0.8);
      ctx.strokeStyle = COLORS.doorWoodDark;
      ctx.lineWidth = Math.max(1, T / 18);
      ctx.strokeRect(x0 + T * 0.1, y0 + T * 0.1, T * 0.8, T * 0.8);
      // Iron bands and a heavy crossbar: reads as "barred", not as a marker.
      ctx.fillStyle = COLORS.doorIron;
      const band = Math.max(1, Math.round(T * 0.07));
      ctx.fillRect(x0 + T * 0.1, y0 + T * 0.24, T * 0.8, band);
      ctx.fillRect(x0 + T * 0.1, y0 + T * 0.62, T * 0.8, band);
      ctx.fillStyle = '#2b1a0c';
      ctx.fillRect(x0 + T * 0.02, y0 + T * 0.4, T * 0.96, Math.max(2, T * 0.14));
      ctx.fillStyle = COLORS.doorIron;
      ctx.fillRect(x0 + T * 0.02, y0 + T * 0.4, Math.max(1, T * 0.08), Math.max(2, T * 0.14));
      ctx.fillRect(x0 + T * 0.9, y0 + T * 0.4, Math.max(1, T * 0.08), Math.max(2, T * 0.14));
      this.objectHp(o.pos, hp, o.maxHp);
      return;
    }
    // Ward anchor.
    const cx = x0 + T / 2;
    const cy = y0 + T / 2;
    if (destroyed) {
      ctx.fillStyle = COLORS.anchorDead;
      diamond(ctx, cx, cy, T * 0.22);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = Math.max(1, T / 20);
      ctx.beginPath();
      ctx.moveTo(cx - T * 0.1, cy - T * 0.15);
      ctx.lineTo(cx + T * 0.05, cy + T * 0.15);
      ctx.stroke();
      return;
    }
    const pulse = 0.75 + 0.25 * Math.sin(input.now / 380 + o.pos.x);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, T * 0.7);
    glow.addColorStop(0, `rgba(170,215,255,${0.75 * pulse})`);
    glow.addColorStop(0.5, `rgba(110,120,255,${0.35 * pulse})`);
    glow.addColorStop(1, 'rgba(90,80,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x0 - T * 0.2, y0 - T * 0.2, T * 1.4, T * 1.4);
    ctx.fillStyle = COLORS.anchorCore;
    diamond(ctx, cx, cy, T * 0.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,90,220,0.9)';
    ctx.lineWidth = Math.max(1, T / 20);
    ctx.stroke();
    this.objectHp(o.pos, hp, o.maxHp);
  }

  private objectHp(p: Pos, hp: number, maxHp: number): void {
    const T = this.tile;
    if (T < 14) {
      this.hpBar(p.x * T + T * 0.12, p.y * T + T * 0.86, T * 0.76, hp, maxHp);
      return;
    }
    const { ctx } = this;
    const fs = Math.max(8, Math.round(T * 0.3));
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

  // --- units ------------------------------------------------------------------

  private drawUnits(input: RenderInput): void {
    const { state, overrides } = input;
    const list: { u: Unit; ghost: boolean }[] = [];
    for (const u of state.units) if (!overrides.hidden[u.id]) list.push({ u, ghost: false });
    for (const g of Object.values(overrides.ghosts)) if (!state.units.some((u) => u.id === g.id)) list.push({ u: g, ghost: true });
    const selId = input.selection.mode === 'unit' ? input.selection.unitId : null;
    for (const { u, ghost } of list) {
      let alpha = 1;
      let scale = 1;
      const a = input.active;
      if (ghost && a && 'unitId' in a.step.event && a.step.event.unitId === u.id && (a.step.kind === 'death' || a.step.kind === 'remove')) {
        alpha = 1 - a.progress;
        scale = a.step.kind === 'death' ? 1 - 0.3 * a.progress : 1 + 0.2 * a.progress;
      } else if (!ghost && u.faction === state.activeFaction && !state.gameOver) {
        if (u.hasMoved && u.hasActed) alpha = 0.42;
        else if (u.hasActed) alpha = 0.72;
      }
      this.drawUnit(u, this.displayPos(u, input), alpha, scale, overrides.hp[u.id] ?? u.hp, u.id === selId, input.now);
    }
  }

  private drawUnit(u: Unit, p: Pos, alpha: number, scale: number, hp: number, selected: boolean, now: number): void {
    const { ctx } = this;
    const T = this.tile;
    const style = FACTION_STYLE[u.faction];
    const cx = (p.x + 0.5) * T;
    const cy = (p.y + 0.46) * T;
    const r = T * 0.34 * scale;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    if (selected) {
      const k = 0.5 + 0.5 * Math.sin(now / 160);
      ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.45 * k})`;
      ctx.lineWidth = Math.max(1.5, T / 12);
      ctx.strokeRect(p.x * T + 1.5, p.y * T + 1.5, T - 3, T - 3);
    }

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.85, r * 0.95, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Token.
    const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    grad.addColorStop(0, style.fill);
    grad.addColorStop(1, style.fillDark);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = style.edge;
    ctx.lineWidth = Math.max(1, T / 18);
    ctx.stroke();

    if (u.rank === 'ascendant') {
      ctx.strokeStyle = style.ring;
      ctx.lineWidth = Math.max(1.5, T / 13);
      ctx.beginPath();
      ctx.arc(cx, cy, r + Math.max(2, T * 0.07), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Glyph.
    const glyph = unitGlyph(u);
    const named = u.character !== null;
    ctx.fillStyle = style.glyph;
    ctx.font = `${named ? 800 : 700} ${Math.max(7, Math.round(T * (named ? 0.42 : 0.36)))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, cx, cy + T * 0.02);

    // Status markers.
    const m = Math.max(3, T * 0.14);
    if (u.statuses.includes('dueling')) {
      ctx.strokeStyle = '#ff6b5b';
      ctx.lineWidth = Math.max(1.5, T / 14);
      const mx = p.x * T + m + 1;
      const my = p.y * T + m + 1;
      ctx.beginPath();
      ctx.moveTo(mx - m, my - m);
      ctx.lineTo(mx + m, my + m);
      ctx.moveTo(mx + m, my - m);
      ctx.lineTo(mx - m, my + m);
      ctx.stroke();
    }
    if (u.statuses.includes('sealed')) {
      ctx.strokeStyle = 'rgba(140,220,255,0.95)';
      ctx.lineWidth = Math.max(1, T / 20);
      ctx.setLineDash([Math.max(2, T / 10), Math.max(2, T / 12)]);
      ctx.beginPath();
      ctx.arc(cx, cy, r + Math.max(4, T * 0.14), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Padlock at the top right.
      const lx = (p.x + 1) * T - m - 2;
      const ly = p.y * T + m + 2;
      ctx.fillStyle = '#8cdcff';
      ctx.fillRect(lx - m * 0.8, ly - m * 0.2, m * 1.6, m * 1.2);
      ctx.beginPath();
      ctx.arc(lx, ly - m * 0.2, m * 0.55, Math.PI, 0);
      ctx.stroke();
    }
    if (u.statuses.includes('drained')) {
      const dx = (p.x + 1) * T - m - 2;
      const dy = p.y * T + m + 2;
      ctx.fillStyle = '#9a96a6';
      ctx.beginPath();
      ctx.moveTo(dx - m, dy - m * 0.5);
      ctx.lineTo(dx + m, dy - m * 0.5);
      ctx.lineTo(dx, dy + m * 0.8);
      ctx.closePath();
      ctx.fill();
    }

    // HP bar.
    this.hpBar(p.x * T + T * 0.12, (p.y + 1) * T - Math.max(3, Math.round(T * 0.12)) - 1, T * 0.76, hp, u.maxHp);
    ctx.restore();
  }

  private hpBar(x: number, y: number, w: number, hp: number, maxHp: number): void {
    const { ctx } = this;
    const T = this.tile;
    const h = Math.max(2, Math.round(T * 0.1));
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    ctx.fillStyle = COLORS.hpBack;
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, Math.round(w) + 2, h + 2);
    ctx.fillStyle = hpColor(ratio);
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w * ratio), h);
  }

  // --- effects ------------------------------------------------------------------

  private drawEffects(input: RenderInput): void {
    const { ctx } = this;
    const T = this.tile;
    for (const e of input.effects) {
      const t = Math.max(0, Math.min(1, (input.now - e.start) / e.life));
      if (t >= 1) continue;
      switch (e.kind) {
        case 'float': {
          const cx = (e.pos.x + 0.5) * T;
          const cy = (e.pos.y + 0.3) * T - t * T * 0.8;
          ctx.globalAlpha = 1 - t * t;
          ctx.font = `800 ${Math.max(11, Math.round(T * 0.5))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = Math.max(2, T / 10);
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(e.text, cx, cy);
          ctx.fillStyle = e.color;
          ctx.fillText(e.text, cx, cy);
          ctx.globalAlpha = 1;
          break;
        }
        case 'pulse': {
          const rad = (0.4 + t * (e.radius + 0.6)) * T;
          const cx = (e.center.x + 0.5) * T;
          const cy = (e.center.y + 0.5) * T;
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(2, T / 6) * (1 - t * 0.6);
          diamond(ctx, cx, cy, rad);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'flash': {
          ctx.globalAlpha = (1 - t) * 0.8;
          ctx.fillStyle = e.color;
          for (const p of e.tiles) ctx.fillRect(p.x * T, p.y * T, T, T);
          ctx.globalAlpha = 1;
          break;
        }
        case 'banner':
          this.drawBanner(e.title, e.subtitle, e.color, t);
          break;
      }
    }
  }

  private drawBanner(title: string, subtitle: string, color: string, t: number): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const fade = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
    const bh = Math.max(48, Math.min(H * 0.22, this.tile * 3));
    const y = H / 2 - bh / 2;
    ctx.globalAlpha = fade;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(8,7,12,0)');
    g.addColorStop(0.2, 'rgba(8,7,12,0.88)');
    g.addColorStop(0.8, 'rgba(8,7,12,0.88)');
    g.addColorStop(1, 'rgba(8,7,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = color;
    ctx.fillRect(W * 0.2, y, W * 0.6, Math.max(1, bh * 0.03));
    ctx.fillRect(W * 0.2, y + bh - Math.max(1, bh * 0.03), W * 0.6, Math.max(1, bh * 0.03));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(bh * 0.38)}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = color;
    ctx.fillText(title, W / 2, y + bh * 0.42);
    ctx.font = `500 ${Math.round(bh * 0.18)}px system-ui, sans-serif`;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(subtitle, W / 2, y + bh * 0.78);
    ctx.globalAlpha = 1;
  }
}

// --- terrain drawing helpers (module-level, used by the cache) ----------------

function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

/** Adds path segments for each edge of tile p whose neighbour is outside the set. */
function outlineEdges(ctx: CanvasRenderingContext2D, p: Pos, T: number, inside: (q: Pos) => boolean): void {
  const x0 = p.x * T;
  const y0 = p.y * T;
  if (!inside({ x: p.x, y: p.y - 1 })) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + T, y0);
  }
  if (!inside({ x: p.x + 1, y: p.y })) {
    ctx.moveTo(x0 + T, y0);
    ctx.lineTo(x0 + T, y0 + T);
  }
  if (!inside({ x: p.x, y: p.y + 1 })) {
    ctx.moveTo(x0, y0 + T);
    ctx.lineTo(x0 + T, y0 + T);
  }
  if (!inside({ x: p.x - 1, y: p.y })) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y0 + T);
  }
}

function terrainAtXY(state: GameState, x: number, y: number): Terrain | undefined {
  return state.map.terrain[y]?.[x];
}

function drawFloor(g: CanvasRenderingContext2D, x: number, y: number, T: number, outdoor: boolean): void {
  const alt = hash(x, y) < 0.5;
  g.fillStyle = outdoor ? (alt ? COLORS.outdoorA : COLORS.outdoorB) : alt ? COLORS.floorA : COLORS.floorB;
  g.fillRect(x * T, y * T, T, T);
  g.fillStyle = COLORS.floorSeam;
  g.fillRect(x * T, y * T, T, 1);
  g.fillRect(x * T, y * T, 1, T);
  if (outdoor && hash(x, y, 7) < 0.25) {
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(x * T + T * 0.2, y * T + T * 0.55, T * 0.5, T * 0.2);
  }
}

function drawWater(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
  g.fillStyle = COLORS.water;
  g.fillRect(x * T, y * T, T, T);
  g.strokeStyle = COLORS.waterWave;
  g.lineWidth = Math.max(1, T / 18);
  for (let i = 0; i < 2; i++) {
    const wy = y * T + T * (0.32 + i * 0.36);
    const ph = hash(x, y, i) * Math.PI * 2;
    g.beginPath();
    for (let s = 0; s <= 8; s++) {
      const wx = x * T + (s / 8) * T;
      const yy = wy + Math.sin(ph + (s / 8) * Math.PI * 2) * T * 0.05;
      if (s === 0) g.moveTo(wx, yy);
      else g.lineTo(wx, yy);
    }
    g.stroke();
  }
}

function drawTerrain(
  g: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
  T: number,
  t: Terrain,
  outdoor: boolean,
  burnedBridge: boolean,
): void {
  const x0 = x * T;
  const y0 = y * T;
  switch (t) {
    case 'floor':
      drawFloor(g, x, y, T, outdoor);
      break;
    case 'wall': {
      g.fillStyle = COLORS.wall;
      g.fillRect(x0, y0, T, T);
      g.fillStyle = COLORS.wallBrick;
      const bh = Math.max(3, Math.round(T / 3));
      for (let row = 0; row * bh < T; row++) {
        const off = row % 2 === 0 ? 0 : T / 2;
        for (let bx = -T; bx < T; bx += T / 2) {
          const left = Math.max(x0, x0 + bx + off + 1);
          const right = Math.min(x0 + T, x0 + bx + off + T / 2 - 1);
          if (right > left) g.fillRect(left, y0 + row * bh + 1, right - left, bh - 2);
        }
      }
      // Lighter lip where the wall meets open ground below.
      const below = terrainAtXY(state, x, y + 1);
      if (below && below !== 'wall') {
        g.fillStyle = COLORS.wallTop;
        g.fillRect(x0, y0 + T - Math.max(2, T / 8), T, Math.max(2, T / 8));
      }
      break;
    }
    case 'door':
      drawFloor(g, x, y, T, outdoor);
      g.fillStyle = COLORS.doorWood;
      g.fillRect(x0 + T * 0.12, y0 + T * 0.12, T * 0.76, T * 0.76);
      g.fillStyle = COLORS.doorWoodDark;
      g.fillRect(x0 + T * 0.48, y0 + T * 0.12, Math.max(1, T * 0.04), T * 0.76);
      g.fillStyle = COLORS.lantern;
      g.fillRect(x0 + T * 0.38, y0 + T * 0.48, Math.max(1, T * 0.07), Math.max(1, T * 0.07));
      g.fillRect(x0 + T * 0.56, y0 + T * 0.48, Math.max(1, T * 0.07), Math.max(1, T * 0.07));
      break;
    case 'rubble':
      drawFloor(g, x, y, T, outdoor);
      for (let i = 0; i < 5; i++) {
        const hx = hash(x, y, i + 1);
        const hy = hash(x, y, i + 11);
        const s = T * (0.1 + hash(x, y, i + 21) * 0.14);
        g.fillStyle = i % 2 === 0 ? COLORS.rubble : COLORS.rubbleDark;
        g.beginPath();
        const cx = x0 + T * (0.15 + hx * 0.7);
        const cy = y0 + T * (0.15 + hy * 0.7);
        g.moveTo(cx - s, cy);
        g.lineTo(cx - s * 0.3, cy - s * 0.8);
        g.lineTo(cx + s, cy - s * 0.2);
        g.lineTo(cx + s * 0.4, cy + s * 0.7);
        g.closePath();
        g.fill();
      }
      break;
    case 'water':
      drawWater(g, x, y, T);
      if (burnedBridge) {
        g.fillStyle = COLORS.charred;
        g.fillRect(x0 + T * 0.08, y0, T * 0.14, T * 0.35);
        g.fillRect(x0 + T * 0.78, y0 + T * 0.6, T * 0.14, T * 0.4);
        g.fillRect(x0 + T * 0.3, y0 + T * 0.45, T * 0.35, T * 0.1);
        g.fillStyle = COLORS.ember;
        g.fillRect(x0 + T * 0.12, y0 + T * 0.3, Math.max(1, T * 0.06), Math.max(1, T * 0.06));
        g.fillRect(x0 + T * 0.55, y0 + T * 0.47, Math.max(1, T * 0.06), Math.max(1, T * 0.06));
      }
      break;
    case 'bridge': {
      drawWater(g, x, y, T);
      const horizontalCanal =
        terrainAtXY(state, x - 1, y) === 'water' || terrainAtXY(state, x + 1, y) === 'water' ||
        terrainAtXY(state, x - 1, y) === 'wall';
      g.fillStyle = COLORS.bridgeWood;
      if (horizontalCanal) {
        g.fillRect(x0 + T * 0.1, y0, T * 0.8, T);
        g.fillStyle = COLORS.bridgeRail;
        for (let i = 1; i < 4; i++) g.fillRect(x0 + T * 0.1, y0 + (i * T) / 4, T * 0.8, Math.max(1, T / 20));
        g.fillRect(x0 + T * 0.06, y0, Math.max(1, T * 0.08), T);
        g.fillRect(x0 + T * 0.86, y0, Math.max(1, T * 0.08), T);
      } else {
        g.fillRect(x0, y0 + T * 0.1, T, T * 0.8);
        g.fillStyle = COLORS.bridgeRail;
        for (let i = 1; i < 4; i++) g.fillRect(x0 + (i * T) / 4, y0 + T * 0.1, Math.max(1, T / 20), T * 0.8);
        g.fillRect(x0, y0 + T * 0.06, T, Math.max(1, T * 0.08));
        g.fillRect(x0, y0 + T * 0.86, T, Math.max(1, T * 0.08));
      }
      break;
    }
    case 'pillar': {
      drawFloor(g, x, y, T, outdoor);
      const cx = x0 + T / 2;
      const cy = y0 + T / 2;
      g.fillStyle = COLORS.pillarShadow;
      g.beginPath();
      g.arc(cx + T * 0.06, cy + T * 0.08, T * 0.34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = COLORS.pillar;
      g.beginPath();
      g.arc(cx, cy, T * 0.32, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = COLORS.pillarHi;
      g.beginPath();
      g.arc(cx - T * 0.09, cy - T * 0.09, T * 0.12, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'throne':
    case 'dais': {
      g.fillStyle = COLORS.carpet;
      g.fillRect(x0, y0, T, T);
      g.strokeStyle = COLORS.carpetTrim;
      g.lineWidth = Math.max(1, T / 18);
      const inside = (q: Pos): boolean => {
        const tt = terrainAtXY(state, q.x, q.y);
        return tt === 'throne' || tt === 'dais';
      };
      g.beginPath();
      const inset = Math.max(1, T * 0.08);
      // Trim along the outer edges of the dais shape.
      if (!inside({ x, y: y - 1 })) {
        g.moveTo(x0, y0 + inset);
        g.lineTo(x0 + T, y0 + inset);
      }
      if (!inside({ x, y: y + 1 })) {
        g.moveTo(x0, y0 + T - inset);
        g.lineTo(x0 + T, y0 + T - inset);
      }
      if (!inside({ x: x - 1, y })) {
        g.moveTo(x0 + inset, y0);
        g.lineTo(x0 + inset, y0 + T);
      }
      if (!inside({ x: x + 1, y })) {
        g.moveTo(x0 + T - inset, y0);
        g.lineTo(x0 + T - inset, y0 + T);
      }
      g.stroke();
      g.fillStyle = 'rgba(201,162,74,0.18)';
      diamond(g, x0 + T / 2, y0 + T / 2, T * 0.18);
      g.fill();
      break;
    }
  }
}

/** Lanterns hang on walls that face open ground; positions are a stable hash. */
function drawLanterns(g: CanvasRenderingContext2D, state: GameState, T: number): void {
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (terrainAtXY(state, x, y) !== 'wall') continue;
      const below = terrainAtXY(state, x, y + 1);
      if (!below || below === 'wall' || below === 'water') continue;
      if (hash(x, y, 99) > 0.16) continue;
      const cx = (x + 0.5) * T;
      const cy = (y + 1) * T - T * 0.1;
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, T * 1.1);
      glow.addColorStop(0, 'rgba(242,195,94,0.38)');
      glow.addColorStop(1, 'rgba(242,195,94,0)');
      g.fillStyle = glow;
      g.fillRect(cx - T * 1.1, cy - T * 1.1, T * 2.2, T * 2.2);
      g.fillStyle = COLORS.lantern;
      g.fillRect(cx - Math.max(1, T * 0.07), cy - Math.max(2, T * 0.14), Math.max(2, T * 0.14), Math.max(2, T * 0.16));
    }
  }
}

function drawZones(g: CanvasRenderingContext2D, state: GameState, T: number): void {
  const entries = Object.entries(state.map.zones);
  g.strokeStyle = COLORS.zoneLine;
  g.lineWidth = Math.max(1, Math.round(T / 24));
  g.setLineDash([Math.max(2, T / 6), Math.max(2, T / 6)]);
  for (const [, tiles] of entries) {
    const set = new Set(tiles.map(posKey));
    g.beginPath();
    for (const p of tiles) outlineEdges(g, p, T, (q) => set.has(posKey(q)));
    g.stroke();
  }
  g.setLineDash([]);
  if (T < 10) return;
  const fs = Math.max(8, Math.round(T * 0.3));
  g.font = `600 ${fs}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  for (const [id, tiles] of entries) {
    if (tiles.length === 0) continue;
    const minX = Math.min(...tiles.map((t) => t.x));
    const minY = Math.min(...tiles.map((t) => t.y));
    const label = zoneName(id).toUpperCase();
    g.fillStyle = 'rgba(0,0,0,0.5)';
    const w = g.measureText(label).width;
    g.fillRect(minX * T + 2, minY * T + 2, w + 4, fs + 2);
    g.fillStyle = COLORS.zoneLabel;
    g.fillText(label, minX * T + 4, minY * T + 3);
  }
}

function drawExits(g: CanvasRenderingContext2D, state: GameState, T: number): void {
  g.fillStyle = COLORS.exit;
  for (const e of state.map.exits) {
    for (const p of e.tiles) {
      const cx = (p.x + 0.5) * T;
      const cy = (p.y + 0.5) * T;
      const dx = p.x === 0 ? -1 : p.x === state.map.width - 1 ? 1 : 0;
      const dy = dx !== 0 ? 0 : p.y === 0 ? -1 : 1;
      const s = T * 0.22;
      g.beginPath();
      g.moveTo(cx + dx * s * 1.4, cy + dy * s * 1.4);
      g.lineTo(cx - dx * s + dy * s, cy - dy * s + dx * s);
      g.lineTo(cx - dx * s - dy * s, cy - dy * s - dx * s);
      g.closePath();
      g.fill();
    }
  }
}

function drawDomainPattern(ctx: CanvasRenderingContext2D, kind: DomainKind, tiles: Pos[], T: number, now: number): void {
  const style = DOMAIN_STYLE[kind];
  ctx.save();
  ctx.strokeStyle = style.edge;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = Math.max(1, T / 24);
  ctx.beginPath();
  const shift = ((now / 60) % T + T) % T;
  for (const p of tiles) {
    const x0 = p.x * T;
    const y0 = p.y * T;
    if (kind === 'tempest' || kind === 'pyre') {
      // Diagonal streaks drifting over time.
      const o = kind === 'tempest' ? shift : T - shift;
      ctx.moveTo(x0 + o * 0.5, y0);
      ctx.lineTo(x0, y0 + o * 0.5);
      ctx.moveTo(x0 + T, y0 + o * 0.5);
      ctx.lineTo(x0 + o * 0.5, y0 + T);
    } else {
      ctx.moveTo(x0 + T * 0.5, y0 + T * 0.3);
      ctx.lineTo(x0 + T * 0.5, y0 + T * 0.7);
      ctx.moveTo(x0 + T * 0.3, y0 + T * 0.5);
      ctx.lineTo(x0 + T * 0.7, y0 + T * 0.5);
    }
  }
  ctx.stroke();
  ctx.restore();
}
