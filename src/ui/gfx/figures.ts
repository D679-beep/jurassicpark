// Figure sprite painters and sprite cache (visual-style.md 5.1-5.4).
// Owner: WS3 (Figures & units).
//
// Every unit is two T x T sprites painted once per tile size and dpr:
//   - `ground`: contact shadow and the faction base plate (rhombus for the
//     Rebels, ellipse for the Loyalists; Ascendants get a double rim). It
//     stays on the floor while the body breathes.
//   - `body`: the character figure (cape, tunic or robe, pauldrons, hood or
//     helm, weapon, rank and character marks), pre-mirrored per facing so the
//     light stays upper-left (5.1 shading) when a unit turns.
// Variants: `normal`, `shade` (night silhouette, NIGHT.tint via source-atop,
// 3.5), `spent` (desaturated, 5.5) and `flash` (white silhouette for the
// impact flash, 6.3). Canvases are created lazily and the whole cache is
// dropped on reset (tile size or dpr change).
//
// Feet sit at FEET*T. Nothing is painted outside the tile; the head, ears,
// crest, halo and weapon tips stay below FIGURE_TOP*T and the plate above
// 0.97T. The HP bar overlays the bottom of the plate and badges/initial
// tabs sit in the top corners (units.ts).
import type { CharacterId, Faction, Rank } from '../../engine';
import { CREST, FACTION, MARK, NIGHT, type FactionTokens } from '../palette';

export type FigureVariant = 'normal' | 'shade' | 'spent' | 'flash';
export type FigurePart = 'ground' | 'body';
export type Facing = 1 | -1;

/** What decides a figure's look: the subset of `Unit` the painters read. */
export interface FigureSpec {
  readonly faction: Faction;
  readonly rank: Rank;
  readonly character: CharacterId | null;
}

/** Characters with a bespoke figure (5.4). Others (future cast) draw as their rank. */
export type DrawnCharacter = 'varek' | 'kaela' | 'grimm' | 'halden' | 'elian' | 'orsa' | 'mira';
const DRAWN: readonly string[] = ['varek', 'kaela', 'grimm', 'halden', 'elian', 'orsa', 'mira'];

export function drawnCharacter(c: CharacterId | null): DrawnCharacter | null {
  return c !== null && DRAWN.includes(c) ? (c as DrawnCharacter) : null;
}

/** Feet line (fraction of T). */
export const FEET = 0.77;
/** Highest painted point of any figure (fraction of T). */
export const FIGURE_TOP = 0.03;
/** Lowest painted point (plate rim, fraction of T). */
export const FIGURE_BOTTOM = 0.97;

/** Height factor about the feet (5.3): Soldier 0.87, Kindled/Radiant 0.93, Ascendant 1, Halden 0.84. */
export function heightFactor(s: FigureSpec): number {
  if (drawnCharacter(s.character) === 'halden') return 0.84;
  switch (s.rank) {
    case 'soldier':
      return 0.87;
    case 'kindled':
    case 'radiant':
      return 0.93;
    case 'ascendant':
      return 1;
  }
}

const VARIANTS: readonly FigureVariant[] = ['normal', 'shade', 'spent', 'flash'];

/** Cache key of one sprite (5.1: `${faction}|${rank}|${character}|${variant}|${T}`, plus part, facing and dpr). */
export function figureKey(s: FigureSpec, part: FigurePart, variant: FigureVariant, facing: Facing, T: number, dpr: number): string {
  const f = part === 'ground' ? 'r' : facing === 1 ? 'r' : 'l';
  return `${s.faction}|${s.rank}|${drawnCharacter(s.character) ?? '-'}|${variant}|${T}|${part}|${f}|${dpr}`;
}

/** Type key (all variants share it): faction, rank, drawn character, T, dpr. */
export function figureTypeKey(s: FigureSpec, T: number, dpr: number): string {
  return `${s.faction}|${s.rank}|${drawnCharacter(s.character) ?? '-'}|${T}|${dpr}`;
}

// --- sprite cache ------------------------------------------------------------------

/** All sprites of one figure type at one tile size; variants are painted on first use. */
export interface FigureSprites {
  readonly key: string;
  readonly T: number;
  readonly dpr: number;
  get(part: FigurePart, variant: FigureVariant, facing: Facing): HTMLCanvasElement;
}

export interface FigureCache {
  sprites(s: FigureSpec, T: number, dpr: number): FigureSprites;
  clear(): void;
  /** Number of painted canvases (for tests and debugging). */
  readonly size: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D is not available');
  return g;
}

export function createFigureCache(): FigureCache {
  const types = new Map<string, FigureSprites>();
  let painted = 0;

  const build = (spec: FigureSpec, T: number, dpr: number, key: string): FigureSprites => {
    const s: FigureSpec = { faction: spec.faction, rank: spec.rank, character: spec.character };
    // index = part*8 + variant*2 + facing
    const slots: (HTMLCanvasElement | null)[] = new Array<HTMLCanvasElement | null>(16).fill(null);
    const get = (part: FigurePart, variant: FigureVariant, facing: Facing): HTMLCanvasElement => {
      const pi = part === 'ground' ? 0 : 1;
      const fi = part === 'ground' || facing === 1 ? 0 : 1;
      const vi = VARIANTS.indexOf(variant);
      const idx = pi * 8 + vi * 2 + fi;
      const hit = slots[idx];
      if (hit) return hit;
      const c = makeCanvas(T, T);
      const g = ctx2d(c);
      if (variant === 'normal') {
        if (part === 'ground') paintGround(g, s, T);
        else paintBody(g, s, T, facing);
      } else {
        const base = get(part, 'normal', facing);
        g.drawImage(base, 0, 0);
        if (variant === 'shade' || variant === 'flash') {
          g.globalCompositeOperation = 'source-atop';
          g.fillStyle = variant === 'shade' ? `rgb(${NIGHT.tint[0]},${NIGHT.tint[1]},${NIGHT.tint[2]})` : '#ffffff';
          g.fillRect(0, 0, T, T);
        } else {
          // spent: desaturate (5.1), keep the silhouette.
          g.globalCompositeOperation = 'saturation';
          g.globalAlpha = 0.7;
          g.fillStyle = '#808080';
          g.fillRect(0, 0, T, T);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'destination-in';
          g.drawImage(base, 0, 0);
        }
        g.globalCompositeOperation = 'source-over';
      }
      slots[idx] = c;
      painted++;
      return c;
    };
    return { key, T, dpr, get };
  };

  return {
    sprites(spec, T, dpr) {
      const key = figureTypeKey(spec, T, dpr);
      let hit = types.get(key);
      if (!hit) {
        hit = build(spec, T, dpr, key);
        types.set(key, hit);
      }
      return hit;
    },
    clear() {
      types.clear();
      painted = 0;
    },
    get size() {
      return painted;
    },
  };
}

// --- painters ----------------------------------------------------------------------

const OUTLINE = FACTION.rebel.outline;
const TAU = Math.PI * 2;

/** Plate geometry (fractions of T), shared with units.ts for the sealed ring. */
export const PLATE = {
  /** Rebel rhombus half extents. */
  rhombusW: 0.39,
  rhombusH: 0.11,
  /** Loyalist ellipse radii. */
  ellipseRx: 0.37,
  ellipseRy: 0.11,
  /** Ascendant outer rim growth (x, y). */
  outerX: 0.06,
  outerY: 0.045,
} as const;

function platePath(g: CanvasRenderingContext2D, rebel: boolean, T: number, gx: number, gy: number): void {
  const cx = 0.5 * T;
  const cy = FEET * T;
  g.beginPath();
  if (rebel) {
    const w = (PLATE.rhombusW + gx) * T;
    const h = (PLATE.rhombusH + gy) * T;
    g.moveTo(cx - w, cy);
    g.lineTo(cx, cy - h);
    g.lineTo(cx + w, cy);
    g.lineTo(cx, cy + h);
    g.closePath();
  } else {
    g.ellipse(cx, cy, (PLATE.ellipseRx + gx) * T, (PLATE.ellipseRy + gy) * T, 0, 0, TAU);
  }
}

/** Contact shadow and faction base plate (5.2, 5.5). */
export function paintGround(g: CanvasRenderingContext2D, s: FigureSpec, T: number): void {
  const rebel = s.faction === 'rebel';
  const c = FACTION[s.faction];
  g.save();
  // Contact shadow.
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.ellipse(0.5 * T, (FEET + 0.02) * T, 0.34 * T, 0.12 * T, 0, 0, TAU);
  g.fill();
  if (s.rank === 'ascendant') {
    // Double rim: outer ring first.
    platePath(g, rebel, T, PLATE.outerX, PLATE.outerY);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fill();
    g.strokeStyle = OUTLINE;
    g.lineWidth = Math.max(1, T / 34) + 2 * Math.max(1, T / 46);
    g.stroke();
    g.strokeStyle = c.accent;
    g.globalAlpha = 0.85;
    g.lineWidth = Math.max(1, T / 34);
    g.stroke();
    g.globalAlpha = 1;
  }
  platePath(g, rebel, T, 0, 0);
  g.fillStyle = c.base;
  g.fill();
  const rim = Math.max(1.5, T / 22);
  g.strokeStyle = OUTLINE;
  g.lineWidth = rim + 2 * Math.max(1, T / 46);
  g.stroke();
  g.strokeStyle = c.accent;
  g.lineWidth = rim;
  g.stroke();
  g.restore();
}

interface Pen {
  readonly g: CanvasRenderingContext2D;
  readonly T: number;
  /** Height factor. */
  readonly h: number;
  /** Outline width. */
  readonly lw: number;
  readonly c: FactionTokens;
  readonly rebel: boolean;
  readonly ch: DrawnCharacter | null;
  readonly rank: Rank;
}

// Painters use design coordinates (tile fractions with the feet at
// DESIGN_FEET); the figure is then widened by SX about the tile's centre line
// and fitted vertically (KY, height factor) onto the real feet line.
const DESIGN_FEET = 0.8;
const SX = 1.12;
const KY = 0.955;
/** Design x -> px. */
const X = (p: Pen, v: number): number => p.T * (0.5 + (v - 0.5) * SX);
/** Design size -> px. */
const W = (p: Pen, v: number): number => p.T * v * SX;
/** Design y (height factor applied about the feet) -> px. */
const Y = (p: Pen, v: number): number => p.T * (FEET - (DESIGN_FEET - v) * p.h * KY);

function outlineStroke(p: Pen, w = p.lw): void {
  p.g.strokeStyle = OUTLINE;
  p.g.lineWidth = w;
  p.g.lineJoin = 'round';
  p.g.stroke();
}

function fillOutline(p: Pen, fill: string | CanvasGradient): void {
  p.g.fillStyle = fill;
  p.g.fill();
  outlineStroke(p);
}

/** A stroked line with a dark casing (weapons, hafts). */
function casedLine(p: Pen, x1: number, y1: number, x2: number, y2: number, col: string, w: number): void {
  const g = p.g;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.strokeStyle = OUTLINE;
  g.lineWidth = w + 2 * p.lw;
  g.stroke();
  g.strokeStyle = col;
  g.lineWidth = w;
  g.stroke();
  g.lineCap = 'butt';
}

/** Soft radial glow (painted once into the sprite). */
function glow(p: Pen, x: number, y: number, rIn: number, rgb: string, a: number): void {
  const g = p.g;
  // Never past the tile edge (a clipped glow would show a hard line).
  const r = Math.min(rIn, x, y, p.T - x, p.T - y);
  if (r <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`);
  gr.addColorStop(0.5, `rgba(${rgb},${a * 0.45})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

function dot(p: Pen, x: number, y: number, r: number, col: string, outlined = true): void {
  const g = p.g;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = col;
  g.fill();
  if (outlined) outlineStroke(p);
}

const SHOULDER = 0.41;
const HEM = 0.765;
const HEAD_Y = 0.27;
const HEAD_R = 0.11;

/**
 * The character figure, mirrored for `facing` -1 (5.1). Pure canvas calls on
 * `g`; exported for the lineup sheet and tests.
 */
export function paintBody(g: CanvasRenderingContext2D, s: FigureSpec, T: number, facing: Facing): void {
  const ch = drawnCharacter(s.character);
  const p: Pen = { g, T, h: heightFactor(s), lw: Math.max(1, T / 30), c: FACTION[s.faction], rebel: s.faction === 'rebel', ch, rank: s.rank };
  g.save();
  if (facing === -1) {
    g.translate(T, 0);
    g.scale(-1, 1);
  }
  // Right half in screen space = local left half when mirrored.
  const shadeX = facing === 1 ? 0.5 * T : 0;
  const asc = s.rank === 'ascendant';
  const robe = s.rank === 'radiant' || ch === 'halden' || ch === 'elian' || ch === 'mira';

  if (asc) paintCape(p);
  if (ch === 'elian') paintHalo(p);
  if (s.rank === 'radiant' && ch !== 'mira') paintStaff(p);
  if (!robe) paintBoots(p);
  paintArmBack(p, robe);
  paintTorso(p, robe, shadeX);
  paintChestMark(p);
  if (s.rank === 'kindled' || asc) paintPauldrons(p);
  if (ch === 'kaela') paintScarf(p);
  paintHead(p);
  paintWeapon(p);
  paintArmFront(p, robe);
  if (asc && ch !== 'elian') paintCirclet(p);
  g.restore();
}

function hemRange(p: Pen, robe: boolean): [number, number] {
  if (p.ch === 'halden') return [0.27, 0.73];
  return robe ? [0.23, 0.77] : [0.29, 0.71];
}

function capeColor(p: Pen): string {
  switch (p.ch) {
    case 'varek':
      return MARK.varekCape;
    case 'grimm':
      return MARK.grimmCape;
    case 'elian':
      return '#e6dcc0';
    case 'orsa':
      return '#7b6d52';
    default:
      return p.rebel ? p.c.cloakDark : '#8c2a30';
  }
}

function paintCape(p: Pen): void {
  const g = p.g;
  const top = Y(p, SHOULDER - 0.01);
  const bot = Y(p, 0.79);
  g.beginPath();
  g.moveTo(X(p, 0.37), top);
  g.lineTo(X(p, 0.63), top);
  g.lineTo(X(p, 0.84), bot);
  if (p.rebel) {
    const n = 5;
    for (let i = 1; i <= n; i++) {
      const xm = 0.84 - (0.68 * (i - 0.5)) / n;
      const xx = 0.84 - (0.68 * i) / n;
      g.lineTo(X(p, xm), Y(p, 0.73));
      g.lineTo(X(p, xx), bot);
    }
  } else {
    g.quadraticCurveTo(X(p, 0.5), Y(p, 0.82), X(p, 0.16), bot);
  }
  g.closePath();
  fillOutline(p, capeColor(p));
  // Inner lining edge so dark capes still read against dark floors.
  g.save();
  g.clip();
  g.strokeStyle = p.ch === 'varek' ? 'rgba(127,227,255,0.45)' : p.ch === 'grimm' ? 'rgba(255,138,46,0.45)' : p.rebel ? 'rgba(111,211,255,0.30)' : 'rgba(255,241,184,0.35)';
  g.lineWidth = Math.max(1, p.T / 40);
  g.beginPath();
  g.moveTo(X(p, 0.38), top + p.lw);
  g.lineTo(X(p, 0.18), bot - p.lw);
  g.stroke();
  g.restore();
}

function paintHalo(p: Pen): void {
  const g = p.g;
  const hx = X(p, 0.5);
  const hy = Y(p, HEAD_Y);
  const hr = W(p, HEAD_R);
  glow(p, hx, hy, hr * 2.2, '255,246,200', 0.6);
  // Pale sun disc behind the head.
  g.beginPath();
  g.arc(hx, hy, hr * 1.5, 0, TAU);
  g.fillStyle = 'rgba(255,236,170,0.85)';
  g.fill();
  g.strokeStyle = '#ffd24a';
  g.lineWidth = Math.max(1, p.T / 40);
  g.stroke();
  g.strokeStyle = MARK.elian;
  g.lineWidth = Math.max(1.5, p.T / 26);
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.31;
    g.moveTo(hx + Math.cos(a) * hr * 1.4, hy + Math.sin(a) * hr * 1.4);
    g.lineTo(hx + Math.cos(a) * hr * 1.9, hy + Math.sin(a) * hr * 1.9);
  }
  g.stroke();
  g.lineCap = 'butt';
}

function paintStaff(p: Pen): void {
  const x = X(p, 0.235);
  const top = Y(p, 0.2);
  casedLine(p, x, Y(p, 0.79), x, top + W(p, 0.03), '#8a6a44', Math.max(1.5, p.T / 22));
  const rgb = p.rebel ? '111,211,255' : '255,240,180';
  glow(p, x, top, W(p, 0.15), rgb, 0.85);
  dot(p, x, top, W(p, 0.05), p.rebel ? '#c8f2ff' : '#fff8d8');
}

function paintBoots(p: Pen): void {
  const g = p.g;
  const y0 = Y(p, 0.73);
  const y1 = FEET * p.T + p.lw;
  g.fillStyle = '#17141b';
  for (const x of [0.395, 0.535]) {
    g.beginPath();
    g.rect(X(p, x), y0, W(p, 0.07), y1 - y0);
    g.fill();
    outlineStroke(p);
  }
}

function bodyColor(p: Pen): string {
  switch (p.ch) {
    case 'halden':
      return '#f1e8d0';
    case 'elian':
      return '#f6f0de';
    case 'orsa':
      return MARK.orsa;
    case 'mira':
      return '#e9e0c6';
    default:
      return p.c.cloak;
  }
}

function sleeveColor(p: Pen): string {
  switch (p.ch) {
    case 'halden':
    case 'elian':
    case 'mira':
      return '#d8cdb0';
    case 'orsa':
      return '#9c8a5e';
    default:
      return p.c.cloakDark;
  }
}

/** Weapon hand position (tile fractions, design y). */
function handPos(p: Pen): [number, number] {
  if (p.rank === 'ascendant') return [0.75, 0.64];
  return [0.7, 0.62];
}

function paintArmBack(p: Pen, robe: boolean): void {
  // Left (back) arm: hangs by the body, or holds the staff.
  const holdsStaff = p.rank === 'radiant' && p.ch !== 'mira';
  const ex = holdsStaff ? 0.25 : p.ch === 'mira' ? 0.4 : robe ? 0.3 : 0.31;
  const ey = holdsStaff ? 0.58 : p.ch === 'mira' ? 0.55 : 0.6;
  casedLine(p, X(p, 0.36), Y(p, SHOULDER + 0.04), X(p, ex), Y(p, ey), sleeveColor(p), Math.max(2, p.T * 0.075));
  if (p.ch !== 'orsa') dot(p, X(p, ex), Y(p, ey), Math.max(1, p.T * 0.032), p.c.skin, false);
}

function paintArmFront(p: Pen, robe: boolean): void {
  const g = p.g;
  if (p.ch === 'halden' || p.ch === 'elian' || p.ch === 'mira') {
    // Hands folded in front (Halden), raised in blessing (Elian), or on the book (Mira).
    const [ex, ey] = p.ch === 'elian' ? [0.66, 0.5] : p.ch === 'mira' ? [0.6, 0.55] : [0.56, 0.6];
    casedLine(p, X(p, 0.64), Y(p, SHOULDER + 0.04), X(p, ex), Y(p, ey), sleeveColor(p), Math.max(2, p.T * 0.075));
    dot(p, X(p, ex), Y(p, ey), Math.max(1, p.T * 0.032), p.c.skin, false);
    return;
  }
  const [hx, hy] = handPos(p);
  casedLine(p, X(p, 0.64), Y(p, SHOULDER + 0.04), X(p, hx), Y(p, hy), sleeveColor(p), Math.max(2, p.T * 0.075));
  g.beginPath();
  g.arc(X(p, hx), Y(p, hy), Math.max(1, p.T * 0.035), 0, TAU);
  g.fillStyle = p.c.skin;
  g.fill();
  outlineStroke(p);
  void robe;
}

function paintTorso(p: Pen, robe: boolean, shadeX: number): void {
  const g = p.g;
  const [hemL, hemR] = hemRange(p, robe);
  const sy = Y(p, SHOULDER);
  const hem = Y(p, HEM);
  const lean = p.ch === 'halden' ? 0.03 : 0;
  g.beginPath();
  g.moveTo(X(p, 0.36 + lean), sy);
  g.lineTo(X(p, 0.64 + lean), sy);
  g.quadraticCurveTo(X(p, 0.69 + lean), sy, X(p, 0.68 + lean), Y(p, SHOULDER + 0.06));
  g.lineTo(X(p, hemR), hem);
  if (p.rebel) {
    // Tattered zigzag hem, 4 teeth.
    const n = 4;
    for (let i = 1; i <= n; i++) {
      const xm = hemR - ((hemR - hemL) * (i - 0.5)) / n;
      const xx = hemR - ((hemR - hemL) * i) / n;
      g.lineTo(X(p, xm), Y(p, HEM - 0.065));
      g.lineTo(X(p, xx), hem);
    }
  } else {
    g.lineTo(X(p, hemL), hem);
  }
  g.lineTo(X(p, 0.32 + lean), Y(p, SHOULDER + 0.06));
  g.quadraticCurveTo(X(p, 0.31 + lean), sy, X(p, 0.36 + lean), sy);
  g.closePath();
  g.fillStyle = bodyColor(p);
  g.fill();

  g.save();
  g.clip();
  if (p.rebel) {
    // Belt with a steel buckle, ash sash.
    g.fillStyle = 'rgba(60,66,78,0.9)';
    g.beginPath();
    g.moveTo(X(p, 0.36), sy);
    g.lineTo(X(p, 0.44), sy);
    g.lineTo(X(p, 0.68), Y(p, 0.6));
    g.lineTo(X(p, 0.6), Y(p, 0.6));
    g.closePath();
    g.fill();
    g.fillStyle = '#1b1d24';
    g.fillRect(0, Y(p, 0.585), p.T, Math.max(1, W(p, 0.045)));
    g.fillStyle = p.c.steel;
    g.fillRect(X(p, 0.47), Y(p, 0.58), Math.max(1, W(p, 0.06)), Math.max(1, W(p, 0.055)));
  } else if (p.ch !== 'orsa') {
    // Ivory tabard stripe and sun disc.
    const royal = p.ch === 'halden' || p.ch === 'elian' || p.ch === 'mira';
    g.fillStyle = royal ? '#d9b14e' : p.c.trim;
    g.fillRect(X(p, 0.455 + lean), sy, W(p, 0.09), hem - sy);
    dot(p, X(p, 0.5 + lean), Y(p, 0.52), W(p, 0.06), royal ? '#fff3c2' : '#b8892c', false);
    g.strokeStyle = royal ? '#9d7426' : '#fff1b8';
    g.lineWidth = Math.max(1, p.T / 46);
    g.stroke();
  } else {
    // Orsa: plate lines on stone armour.
    g.strokeStyle = 'rgba(60,48,28,0.55)';
    g.lineWidth = Math.max(1, p.T / 40);
    g.beginPath();
    g.moveTo(X(p, 0.3), Y(p, 0.53));
    g.lineTo(X(p, 0.7), Y(p, 0.53));
    g.moveTo(X(p, 0.29), Y(p, 0.64));
    g.lineTo(X(p, 0.71), Y(p, 0.64));
    g.stroke();
  }
  // Light from the upper left: shade the right half (5.1).
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(shadeX, 0, 0.5 * p.T, p.T);
  g.restore();
  outlineStroke(p);
}

function paintChestMark(p: Pen): void {
  const g = p.g;
  if (p.ch === 'varek') {
    // Cyan lightning bolt.
    g.beginPath();
    g.moveTo(X(p, 0.535), Y(p, 0.44));
    g.lineTo(X(p, 0.43), Y(p, 0.555));
    g.lineTo(X(p, 0.5), Y(p, 0.555));
    g.lineTo(X(p, 0.45), Y(p, 0.68));
    g.lineTo(X(p, 0.58), Y(p, 0.525));
    g.lineTo(X(p, 0.51), Y(p, 0.525));
    g.lineTo(X(p, 0.56), Y(p, 0.44));
    g.closePath();
    g.fillStyle = MARK.varek;
    g.fill();
    g.strokeStyle = 'rgba(4,5,10,0.6)';
    g.lineWidth = Math.max(1, p.T / 60);
    g.stroke();
  } else if (p.ch === 'grimm') {
    // Flame emblem.
    g.beginPath();
    g.moveTo(X(p, 0.5), Y(p, 0.43));
    g.quadraticCurveTo(X(p, 0.6), Y(p, 0.54), X(p, 0.56), Y(p, 0.62));
    g.quadraticCurveTo(X(p, 0.5), Y(p, 0.68), X(p, 0.44), Y(p, 0.62));
    g.quadraticCurveTo(X(p, 0.42), Y(p, 0.54), X(p, 0.48), Y(p, 0.5));
    g.quadraticCurveTo(X(p, 0.49), Y(p, 0.55), X(p, 0.5), Y(p, 0.43));
    g.closePath();
    g.fillStyle = MARK.grimm;
    g.fill();
    g.fillStyle = '#ffd27a';
    g.beginPath();
    g.arc(X(p, 0.5), Y(p, 0.615), W(p, 0.028), 0, TAU);
    g.fill();
  }
}

function paintPauldrons(p: Pen): void {
  const g = p.g;
  const col = p.ch === 'orsa' ? '#d8c48f' : p.ch === 'elian' ? '#efe0b0' : p.c.steel;
  for (const sx of [0.33, 0.67]) {
    g.beginPath();
    if (p.rebel) {
      // Triangular spikes.
      g.moveTo(X(p, sx - 0.085), Y(p, SHOULDER + 0.05));
      g.lineTo(X(p, sx + (sx < 0.5 ? -0.03 : 0.03)), Y(p, SHOULDER - 0.06));
      g.lineTo(X(p, sx + 0.085), Y(p, SHOULDER + 0.05));
      g.closePath();
    } else {
      g.arc(X(p, sx), Y(p, SHOULDER + 0.04), W(p, 0.075), Math.PI, 0);
      g.closePath();
    }
    fillOutline(p, col);
  }
}

function paintScarf(p: Pen): void {
  const g = p.g;
  const y = Y(p, SHOULDER);
  g.beginPath();
  g.moveTo(X(p, 0.37), y - p.lw);
  g.lineTo(X(p, 0.63), y - p.lw);
  g.lineTo(X(p, 0.6), y + W(p, 0.06));
  g.lineTo(X(p, 0.36), y + W(p, 0.07));
  // Streaming tails to the back.
  g.lineTo(X(p, 0.16), y + W(p, 0.14));
  g.lineTo(X(p, 0.21), y + W(p, 0.08));
  g.lineTo(X(p, 0.12), y + W(p, 0.07));
  g.lineTo(X(p, 0.3), y + W(p, 0.01));
  g.closePath();
  fillOutline(p, MARK.kaela);
}

function paintHead(p: Pen): void {
  const g = p.g;
  const lean = p.ch === 'halden' ? 0.05 : 0;
  const hx = X(p, 0.5 + lean);
  const hy = Y(p, HEAD_Y) + (p.ch === 'halden' ? W(p, 0.02) : 0);
  const hr = W(p, p.ch === 'halden' ? 0.1 : HEAD_R);

  if (p.rebel) {
    paintWolfHood(p, hx, hy, hr);
    return;
  }
  // Face.
  g.beginPath();
  g.arc(hx, hy, hr, 0, TAU);
  fillOutline(p, p.c.skin);
  if (p.ch === 'halden') paintHalden(p, hx, hy, hr);
  else if (p.ch === 'elian') paintElianHair(p, hx, hy, hr);
  else if (p.ch === 'mira') paintCowl(p, hx, hy, hr);
  else paintHelm(p, hx, hy, hr);
}

function paintWolfHood(p: Pen, hx: number, hy: number, hr: number): void {
  const g = p.g;
  const hood = p.ch === 'kaela' ? '#2c4566' : p.ch === 'grimm' ? '#2b2a33' : '#2a4262';
  g.beginPath();
  g.moveTo(hx - hr * 1.12, hy + hr * 0.95);
  g.lineTo(hx - hr * 1.22, hy - hr * 0.25);
  g.lineTo(hx - hr * 1.02, hy - hr * 1.9); // left ear tip
  g.lineTo(hx - hr * 0.3, hy - hr * 1.02);
  g.quadraticCurveTo(hx, hy - hr * 1.15, hx + hr * 0.3, hy - hr * 1.02);
  g.lineTo(hx + hr * 1.02, hy - hr * 1.9); // right ear tip
  g.lineTo(hx + hr * 1.22, hy - hr * 0.25);
  g.lineTo(hx + hr * 1.12, hy + hr * 0.95);
  g.quadraticCurveTo(hx, hy + hr * 1.35, hx - hr * 1.12, hy + hr * 0.95);
  g.closePath();
  fillOutline(p, hood);
  // Inner ears and a lit top edge so the ears read on dark floors.
  g.fillStyle = 'rgba(169,185,201,0.55)';
  for (const sgn of [-1, 1]) {
    g.beginPath();
    g.moveTo(hx + sgn * hr * 0.98, hy - hr * 1.62);
    g.lineTo(hx + sgn * hr * 0.55, hy - hr * 1.0);
    g.lineTo(hx + sgn * hr * 1.05, hy - hr * 0.95);
    g.closePath();
    g.fill();
  }
  // Shadowed face opening with glinting eyes.
  g.beginPath();
  g.ellipse(hx + hr * 0.08, hy + hr * 0.18, hr * 0.66, hr * 0.62, 0, 0, TAU);
  g.fillStyle = '#0a0e16';
  g.fill();
  const eye = p.ch === 'grimm' ? MARK.grimm : p.c.accent;
  const ew = Math.max(1, hr * 0.3);
  const eh = Math.max(1, hr * 0.2);
  g.fillStyle = eye;
  g.fillRect(hx - hr * 0.34, hy + hr * 0.05, ew, eh);
  g.fillRect(hx + hr * 0.24, hy + hr * 0.05, ew, eh);
}

function paintHelm(p: Pen, hx: number, hy: number, hr: number): void {
  const g = p.g;
  const steel = p.ch === 'orsa' ? '#d4c190' : p.c.steel;
  // Oval crest first (behind the dome's top edge).
  g.beginPath();
  g.ellipse(hx - hr * 0.05, hy - hr * 1.38, hr * 0.42, hr * 0.62, -0.12, 0, TAU);
  fillOutline(p, p.ch === 'orsa' ? '#8a857c' : CREST);
  // Round helm dome with cheek guards.
  g.beginPath();
  g.arc(hx, hy - hr * 0.05, hr * 1.18, Math.PI, 0);
  g.lineTo(hx + hr * 1.18, hy + hr * 0.6);
  g.lineTo(hx + hr * 0.62, hy + hr * 0.6);
  g.lineTo(hx + hr * 0.62, hy + hr * 0.12);
  g.lineTo(hx - hr * 0.62, hy + hr * 0.12);
  g.lineTo(hx - hr * 0.62, hy + hr * 0.6);
  g.lineTo(hx - hr * 1.18, hy + hr * 0.6);
  g.closePath();
  fillOutline(p, steel);
  // Highlight top-left, visor slit.
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = Math.max(1, p.T / 46);
  g.beginPath();
  g.arc(hx, hy - hr * 0.05, hr * 0.85, Math.PI * 1.15, Math.PI * 1.45);
  g.stroke();
  g.fillStyle = '#1a1408';
  g.fillRect(hx - hr * 0.7, hy - hr * 0.12, hr * 1.4, Math.max(1, hr * 0.24));
}

function paintHalden(p: Pen, hx: number, hy: number, hr: number): void {
  const g = p.g;
  // White hair at the sides and a long beard.
  g.fillStyle = '#ece6da';
  g.beginPath();
  g.moveTo(hx - hr * 0.95, hy - hr * 0.1);
  g.quadraticCurveTo(hx - hr * 0.9, hy + hr * 1.0, hx, hy + hr * 1.65);
  g.quadraticCurveTo(hx + hr * 0.9, hy + hr * 1.0, hx + hr * 0.95, hy - hr * 0.1);
  g.lineTo(hx + hr * 0.6, hy + hr * 0.35);
  g.lineTo(hx - hr * 0.6, hy + hr * 0.35);
  g.closePath();
  g.fill();
  outlineStroke(p);
  g.fillStyle = '#3a2a1a';
  g.fillRect(hx - hr * 0.42, hy - hr * 0.05, Math.max(1, hr * 0.22), Math.max(1, hr * 0.2));
  g.fillRect(hx + hr * 0.25, hy - hr * 0.05, Math.max(1, hr * 0.22), Math.max(1, hr * 0.2));
  // Gold three-point crown.
  g.beginPath();
  g.moveTo(hx - hr * 1.0, hy - hr * 0.45);
  g.lineTo(hx - hr * 1.08, hy - hr * 1.6);
  g.lineTo(hx - hr * 0.5, hy - hr * 1.05);
  g.lineTo(hx, hy - hr * 1.95);
  g.lineTo(hx + hr * 0.5, hy - hr * 1.05);
  g.lineTo(hx + hr * 1.08, hy - hr * 1.6);
  g.lineTo(hx + hr * 1.0, hy - hr * 0.45);
  g.closePath();
  fillOutline(p, MARK.halden);
  g.fillStyle = '#c0392b';
  g.beginPath();
  g.arc(hx, hy - hr * 0.78, Math.max(1, hr * 0.2), 0, TAU);
  g.fill();
}

function paintElianHair(p: Pen, hx: number, hy: number, hr: number): void {
  const g = p.g;
  g.beginPath();
  g.moveTo(hx - hr * 1.08, hy + hr * 0.55);
  g.quadraticCurveTo(hx - hr * 1.25, hy - hr * 1.25, hx, hy - hr * 1.15);
  g.quadraticCurveTo(hx + hr * 1.25, hy - hr * 1.25, hx + hr * 1.08, hy + hr * 0.55);
  g.lineTo(hx + hr * 0.75, hy - hr * 0.2);
  g.quadraticCurveTo(hx, hy - hr * 0.55, hx - hr * 0.75, hy - hr * 0.2);
  g.closePath();
  fillOutline(p, '#e8c45a');
  g.fillStyle = '#3a2a1a';
  g.fillRect(hx - hr * 0.42, hy + hr * 0.05, Math.max(1, hr * 0.22), Math.max(1, hr * 0.2));
  g.fillRect(hx + hr * 0.22, hy + hr * 0.05, Math.max(1, hr * 0.22), Math.max(1, hr * 0.2));
}

function paintCowl(p: Pen, hx: number, hy: number, hr: number): void {
  const g = p.g;
  g.beginPath();
  g.arc(hx, hy - hr * 0.05, hr * 1.32, Math.PI * 0.92, Math.PI * 2.08);
  g.lineTo(hx + hr * 1.35, hy + hr * 1.05);
  g.lineTo(hx + hr * 0.72, hy + hr * 0.4);
  g.arc(hx, hy + hr * 0.05, hr * 0.74, 0.2, Math.PI - 0.2, true);
  g.lineTo(hx - hr * 1.35, hy + hr * 1.05);
  g.closePath();
  fillOutline(p, MARK.mira);
  g.fillStyle = '#3a2a1a';
  g.fillRect(hx - hr * 0.4, hy + hr * 0.05, Math.max(1, hr * 0.2), Math.max(1, hr * 0.2));
  g.fillRect(hx + hr * 0.2, hy + hr * 0.05, Math.max(1, hr * 0.2), Math.max(1, hr * 0.2));
}

function paintWeapon(p: Pen): void {
  const g = p.g;
  const T = p.T;
  const wcol = p.rebel ? '#c9d3dd' : '#f2ead2';
  const haft = '#7a5a36';
  if (p.ch === 'halden' || p.ch === 'elian') return;
  if (p.ch === 'mira') {
    // Open book with teal glow.
    const cx = X(p, 0.5);
    const cy = Y(p, 0.57);
    glow(p, cx, cy - W(p, 0.02), W(p, 0.2), '127,224,208', 0.7);
    const w = W(p, 0.15);
    const hgt = W(p, 0.11);
    g.beginPath();
    g.moveTo(cx, cy - hgt * 0.35);
    g.lineTo(cx - w, cy - hgt * 0.6);
    g.lineTo(cx - w, cy + hgt * 0.45);
    g.lineTo(cx, cy + hgt * 0.65);
    g.lineTo(cx + w, cy + hgt * 0.45);
    g.lineTo(cx + w, cy - hgt * 0.6);
    g.closePath();
    fillOutline(p, '#f3ead2');
    g.strokeStyle = MARK.miraGlow;
    g.lineWidth = Math.max(1, T / 34);
    g.beginPath();
    g.moveTo(cx, cy - hgt * 0.35);
    g.lineTo(cx, cy + hgt * 0.65);
    g.stroke();
    return;
  }
  if (p.ch === 'orsa') {
    // Short sword (right) and tower shield (left, in front of the body).
    casedLine(p, X(p, 0.74), Y(p, 0.66), X(p, 0.8), Y(p, 0.3), wcol, Math.max(2, T / 18));
    casedLine(p, X(p, 0.68), Y(p, 0.6), X(p, 0.82), Y(p, 0.62), '#c9a24a', Math.max(1, T / 26));
    const x0 = X(p, 0.13);
    const y0 = Y(p, 0.42);
    const w = W(p, 0.24);
    const hh = W(p, 0.31);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + w, y0);
    g.lineTo(x0 + w, y0 + hh * 0.82);
    g.quadraticCurveTo(x0 + w / 2, y0 + hh * 1.04, x0, y0 + hh * 0.82);
    g.closePath();
    fillOutline(p, MARK.orsaShield);
    g.strokeStyle = MARK.orsaShieldRim;
    g.lineWidth = Math.max(1, T / 24);
    g.stroke();
    dot(p, x0 + w / 2, y0 + hh * 0.42, W(p, 0.04), MARK.orsaShieldRim, true);
    return;
  }
  if (p.rank === 'radiant') return; // staff painted behind the body
  if (p.ch === 'grimm') {
    // Great axe.
    casedLine(p, X(p, 0.78), Y(p, 0.16), X(p, 0.745), Y(p, 0.765), '#6a4a2a', Math.max(2, T / 18));
    g.beginPath();
    g.moveTo(X(p, 0.79), Y(p, 0.15));
    g.quadraticCurveTo(X(p, 0.9), Y(p, 0.18), X(p, 0.89), Y(p, 0.42));
    g.quadraticCurveTo(X(p, 0.84), Y(p, 0.33), X(p, 0.77), Y(p, 0.35));
    g.closePath();
    fillOutline(p, '#c9d3dd');
    g.strokeStyle = 'rgba(255,138,46,0.8)';
    g.lineWidth = Math.max(1, T / 40);
    g.beginPath();
    g.moveTo(X(p, 0.84), Y(p, 0.18));
    g.quadraticCurveTo(X(p, 0.89), Y(p, 0.24), X(p, 0.875), Y(p, 0.38));
    g.stroke();
    return;
  }
  if (p.rank === 'ascendant') {
    // Greatsword with a gold crossguard.
    const [hx, hy] = handPos(p);
    const tipY = Math.max(FIGURE_TOP * T + T * 0.03, Y(p, 0.08));
    const bx = X(p, hx + 0.012);
    const by = Y(p, hy - 0.04);
    if (p.ch === 'varek') glow(p, X(p, 0.81), Y(p, 0.32), W(p, 0.11), '127,227,255', 0.35);
    casedLine(p, bx, by, X(p, 0.84), tipY, wcol, Math.max(2, T / 15));
    casedLine(p, X(p, hx - 0.075), Y(p, hy - 0.035), X(p, hx + 0.095), Y(p, hy - 0.06), '#c9a24a', Math.max(1.5, T / 22));
    dot(p, X(p, hx - 0.008), Y(p, hy + 0.05), Math.max(1, T * 0.025), '#c9a24a');
    return;
  }
  if (p.rank === 'kindled') {
    // Mana-sheathed sword: glow stroke, then the blade.
    const [hx, hy] = handPos(p);
    const glowCol = p.rebel ? 'rgba(111,211,255,0.5)' : 'rgba(255,241,184,0.55)';
    g.lineCap = 'round';
    g.strokeStyle = glowCol;
    g.lineWidth = Math.max(3, T / 9);
    g.beginPath();
    g.moveTo(X(p, hx + 0.025), Y(p, hy - 0.08));
    g.lineTo(X(p, 0.82), Y(p, 0.2));
    g.stroke();
    g.lineCap = 'butt';
    casedLine(p, X(p, hx + 0.01), Y(p, hy - 0.02), X(p, 0.82), Y(p, 0.2), p.rebel ? '#bff0ff' : '#fff6d0', Math.max(1.5, T / 20));
    casedLine(p, X(p, hx - 0.06), Y(p, hy - 0.03), X(p, hx + 0.08), Y(p, hy - 0.06), '#6a5030', Math.max(1, T / 26));
    return;
  }
  // Soldier.
  if (p.rebel) {
    // Hand axe: wedge head to the right.
    const [hx, hy] = handPos(p);
    casedLine(p, X(p, hx - 0.01), Y(p, hy + 0.06), X(p, 0.76), Y(p, 0.3), haft, Math.max(1.5, T / 22));
    g.beginPath();
    g.moveTo(X(p, 0.745), Y(p, 0.3));
    g.lineTo(X(p, 0.9), Y(p, 0.24));
    g.lineTo(X(p, 0.9), Y(p, 0.45));
    g.lineTo(X(p, 0.75), Y(p, 0.39));
    g.closePath();
    fillOutline(p, wcol);
    return;
  }
  // Spear with a leaf head, tip at the top of the tile.
  const sx = X(p, 0.74);
  const tip = FIGURE_TOP * T + T * 0.02;
  casedLine(p, sx, Y(p, 0.79), sx, tip + T * 0.1, haft, Math.max(1.5, T / 22));
  g.beginPath();
  g.moveTo(sx, tip);
  g.quadraticCurveTo(sx + T * 0.06, tip + T * 0.08, sx, tip + T * 0.15);
  g.quadraticCurveTo(sx - T * 0.06, tip + T * 0.08, sx, tip);
  g.closePath();
  fillOutline(p, wcol);
  casedLine(p, sx - T * 0.045, tip + T * 0.16, sx + T * 0.045, tip + T * 0.16, '#c9a24a', Math.max(1, T / 30));
}

function paintCirclet(p: Pen): void {
  const g = p.g;
  const hx = X(p, 0.5);
  const hy = Y(p, HEAD_Y);
  const hr = W(p, HEAD_R);
  const col = p.ch === 'grimm' ? MARK.grimm : p.rebel ? MARK.varek : '#fff1b8';
  const rgb = p.ch === 'grimm' ? '255,138,46' : p.rebel ? '127,227,255' : '255,241,184';
  // Worn on the brow: a thin back arc, a bold front arc with a gem, soft glow.
  const cy = hy - hr * 1.2;
  const rx = hr * 0.92;
  const ry = hr * 0.28;
  glow(p, hx, cy, hr * 1.35, rgb, 0.3);
  const lw = Math.max(1.5, p.T / 22);
  g.strokeStyle = col;
  g.globalAlpha = 0.55;
  g.lineWidth = Math.max(1, lw * 0.6);
  g.beginPath();
  g.ellipse(hx, cy, rx, ry, 0, Math.PI, TAU);
  g.stroke();
  g.globalAlpha = 1;
  g.beginPath();
  g.ellipse(hx, cy, rx, ry, 0, 0, Math.PI);
  g.strokeStyle = OUTLINE;
  g.lineWidth = lw + 2 * Math.max(1, p.T / 60);
  g.stroke();
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.stroke();
  // Front gem.
  dot(p, hx, cy + ry, Math.max(1, hr * 0.2), col, false);
}

// --- initial tab ----------------------------------------------------------------------

/** Initial-tab font size in device px (5.4): max(9 css px, 0.22T). */
export function tabFontSize(T: number, dpr: number): number {
  return Math.max(Math.round(9 * dpr), Math.round(0.22 * T));
}

/** Initial tab sprite: dark plate, faction underline, serif bold initial. */
export function paintTab(initial: string, faction: Faction, T: number, dpr: number): HTMLCanvasElement {
  const fs = tabFontSize(T, dpr);
  const w = Math.ceil(fs * 1.15);
  const h = Math.ceil(fs * 1.1);
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = 'rgba(8,8,14,0.85)';
  g.fillRect(0, 0, w, h);
  const ul = Math.max(1, Math.round(dpr));
  g.fillStyle = FACTION[faction].tab;
  g.fillRect(0, h - ul, w, ul);
  g.font = `700 ${fs}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = faction === 'rebel' ? '#e6f6ff' : '#fff3cf';
  g.fillText(initial, w / 2, (h - ul) / 2 + fs * 0.06);
  return c;
}
