// Canvas status badges (visual-style.md 5.5): round dark badges at the top
// right of a unit's tile, right to left in the order sealed, dueling,
// drained, escapee (escapee only while not sealed). Icons: crossed swords
// (with crossguards and pommels, never a plain X), padlock, cracked drop,
// arrow out. Painted once per kind, tile size and dpr into small sprites.
// Owner: WS3 (Figures & units).
import type { Unit } from '../../engine';
import { STATUS } from '../palette';

export type BadgeKind = 'sealed' | 'dueling' | 'drained' | 'escapee';

/** Badge radius in device px: max(5.5 css px, 0.14T). */
export function badgeRadius(T: number, dpr: number): number {
  return Math.max(5.5 * dpr, 0.14 * T);
}

/**
 * The badges a unit shows, in drawing order (rightmost first). Writes into
 * `out` (cleared) and returns it, so the per-frame pass does not allocate.
 */
export function unitBadges(u: Pick<Unit, 'statuses' | 'tags'>, out: BadgeKind[]): BadgeKind[] {
  out.length = 0;
  const sealed = u.statuses.includes('sealed');
  if (sealed) out.push('sealed');
  if (u.statuses.includes('dueling')) out.push('dueling');
  if (u.statuses.includes('drained')) out.push('drained');
  if (!sealed && u.tags.includes('escapee')) out.push('escapee');
  return out;
}

/**
 * Badge centres inside a tile (device px from the tile's top-left), right to
 * left along the top edge; a badge that would run into the initial tab
 * (`tabRight` px from the left, 0 when none) drops below the previous one.
 * Writes pairs [x0, y0, x1, y1, ...] into `out`.
 */
export function badgeLayout(count: number, T: number, r: number, tabRight: number, out: number[]): number[] {
  out.length = 0;
  const gap = Math.max(1, Math.round(r * 0.15));
  let x = T - r - 1;
  let y = r + 1;
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      const nx = x - 2 * r - gap;
      if (nx - r < tabRight + gap) y += 2 * r + gap;
      else x = nx;
    }
    out.push(x, y);
  }
  return out;
}

const COLOR: Record<BadgeKind, string> = {
  sealed: STATUS.sealed,
  dueling: STATUS.dueling,
  drained: STATUS.drained,
  escapee: STATUS.escapee,
};

/** Paints one badge centred at (cx, cy) with radius r. Pure canvas calls. */
export function paintBadge(g: CanvasRenderingContext2D, kind: BadgeKind, cx: number, cy: number, r: number): void {
  const col = COLOR[kind];
  g.save();
  g.fillStyle = STATUS.badgeFill;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  const ring = Math.max(1, r / 5);
  g.strokeStyle = col;
  g.lineWidth = ring;
  g.beginPath();
  g.arc(cx, cy, r - ring / 2, 0, Math.PI * 2);
  g.stroke();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const k = r - ring; // inner radius
  switch (kind) {
    case 'dueling':
      paintSwords(g, cx, cy, k, r);
      break;
    case 'sealed':
      paintPadlock(g, cx, cy, k, col);
      break;
    case 'drained':
      paintDrop(g, cx, cy, k, col);
      break;
    case 'escapee':
      paintArrowOut(g, cx, cy, k, col, r);
      break;
  }
  g.restore();
}

function paintSwords(g: CanvasRenderingContext2D, cx: number, cy: number, k: number, r: number): void {
  // Two diagonal steel blades; each hilt has a gold crossguard bar across the
  // blade (a small diagonal cross of its own) and a pommel: never a plain X.
  const blade = Math.max(1, r / 4.5);
  for (const s of [1, -1]) {
    const hx = cx - s * k * 0.7;
    const hy = cy + k * 0.7;
    const tx = cx + s * k * 0.74;
    const ty = cy - k * 0.74;
    const len = Math.hypot(tx - hx, ty - hy);
    const ux = (tx - hx) / len;
    const uy = (ty - hy) / len;
    // Crossguard position along the sword.
    const gx = hx + ux * len * 0.26;
    const gy = hy + uy * len * 0.26;
    // Steel blade and grip in one line (from just past the pommel to a point).
    g.strokeStyle = '#e8edf2';
    g.lineWidth = blade;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(hx + ux * k * 0.12, hy + uy * k * 0.12);
    g.lineTo(tx - ux * blade, ty - uy * blade);
    g.stroke();
    g.fillStyle = '#e8edf2';
    g.beginPath();
    g.moveTo(tx + ux * blade * 0.3, ty + uy * blade * 0.3);
    g.lineTo(tx - ux * blade * 1.2 - uy * blade * 0.55, ty - uy * blade * 1.2 + ux * blade * 0.55);
    g.lineTo(tx - ux * blade * 1.2 + uy * blade * 0.55, ty - uy * blade * 1.2 - ux * blade * 0.55);
    g.closePath();
    g.fill();
    // Crossguard: a distinct perpendicular gold bar.
    const cl = k * 0.32;
    g.strokeStyle = '#ffd27a';
    g.lineWidth = Math.max(1, blade * 1.1);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(gx - uy * cl, gy + ux * cl);
    g.lineTo(gx + uy * cl, gy - ux * cl);
    g.stroke();
    g.fillStyle = '#ffd27a';
    g.beginPath();
    g.arc(hx, hy, Math.max(0.8, k * 0.13), 0, Math.PI * 2);
    g.fill();
  }
}

function paintPadlock(g: CanvasRenderingContext2D, cx: number, cy: number, k: number, col: string): void {
  // Shackle.
  g.strokeStyle = col;
  g.lineWidth = Math.max(1, k * 0.22);
  g.beginPath();
  g.moveTo(cx - k * 0.42, cy);
  g.lineTo(cx - k * 0.42, cy - k * 0.3);
  g.arc(cx, cy - k * 0.3, k * 0.42, Math.PI, 0);
  g.lineTo(cx + k * 0.42, cy);
  g.stroke();
  // Body and keyhole.
  g.fillStyle = col;
  g.fillRect(cx - k * 0.66, cy - k * 0.08, k * 1.32, k * 0.86);
  g.fillStyle = STATUS.badgeFill;
  g.beginPath();
  g.arc(cx, cy + k * 0.25, Math.max(0.7, k * 0.15), 0, Math.PI * 2);
  g.fill();
  g.fillRect(cx - Math.max(0.5, k * 0.06), cy + k * 0.25, Math.max(1, k * 0.12), k * 0.32);
}

function paintDrop(g: CanvasRenderingContext2D, cx: number, cy: number, k: number, col: string): void {
  g.beginPath();
  g.moveTo(cx, cy - k * 0.85);
  g.bezierCurveTo(cx + k * 0.25, cy - k * 0.4, cx + k * 0.72, cy + k * 0.05, cx + k * 0.6, cy + k * 0.42);
  g.arc(cx, cy + k * 0.3, k * 0.6, 0.2, Math.PI - 0.2);
  g.bezierCurveTo(cx - k * 0.72, cy + k * 0.05, cx - k * 0.25, cy - k * 0.4, cx, cy - k * 0.85);
  g.closePath();
  g.fillStyle = 'rgba(181,168,214,0.35)';
  g.fill();
  g.strokeStyle = col;
  g.lineWidth = Math.max(1, k * 0.2);
  g.stroke();
  // Crack.
  g.strokeStyle = STATUS.badgeFill;
  g.lineWidth = Math.max(1, k * 0.18);
  g.beginPath();
  g.moveTo(cx - k * 0.05, cy - k * 0.55);
  g.lineTo(cx + k * 0.18, cy - k * 0.05);
  g.lineTo(cx - k * 0.16, cy + k * 0.2);
  g.lineTo(cx + k * 0.08, cy + k * 0.75);
  g.stroke();
}

function paintArrowOut(g: CanvasRenderingContext2D, cx: number, cy: number, k: number, col: string, r: number): void {
  const w = Math.max(1.2, r / 4);
  g.strokeStyle = col;
  g.lineWidth = w;
  // Door frame (open bracket on the left).
  g.beginPath();
  g.moveTo(cx - k * 0.1, cy - k * 0.7);
  g.lineTo(cx - k * 0.7, cy - k * 0.7);
  g.lineTo(cx - k * 0.7, cy + k * 0.7);
  g.lineTo(cx - k * 0.1, cy + k * 0.7);
  g.stroke();
  // Arrow leaving to the right.
  g.beginPath();
  g.moveTo(cx - k * 0.35, cy);
  g.lineTo(cx + k * 0.72, cy);
  g.moveTo(cx + k * 0.3, cy - k * 0.42);
  g.lineTo(cx + k * 0.75, cy);
  g.lineTo(cx + k * 0.3, cy + k * 0.42);
  g.stroke();
}

// --- sprite cache -------------------------------------------------------------------

const KINDS: readonly BadgeKind[] = ['sealed', 'dueling', 'drained', 'escapee'];

export interface BadgeSprites {
  /** Badge sprite (size 2r + 2, centre at r + 1). */
  get(kind: BadgeKind, T: number, dpr: number): HTMLCanvasElement;
  clear(): void;
}

export function createBadgeSprites(): BadgeSprites {
  const sprites: (HTMLCanvasElement | null)[] = [null, null, null, null];
  let keyT = -1;
  let keyDpr = -1;
  return {
    get(kind, T, dpr) {
      if (T !== keyT || dpr !== keyDpr) {
        sprites.fill(null);
        keyT = T;
        keyDpr = dpr;
      }
      const i = KINDS.indexOf(kind);
      let c = sprites[i];
      if (!c) {
        const r = badgeRadius(T, dpr);
        const size = Math.ceil(2 * r + 2);
        c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const g = c.getContext('2d');
        if (g) paintBadge(g, kind, size / 2, size / 2, r);
        sprites[i] = c;
      }
      return c;
    },
    clear() {
      sprites.fill(null);
      keyT = -1;
      keyDpr = -1;
    },
  };
}
