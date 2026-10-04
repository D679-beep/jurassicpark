// Floor painters per Material (visual-style.md 4.1, 1.2).
// Owner: WS1 (Terrain & objects). One painter per `Material`, driven by
// `sites.material[y][x]`; each paints one full tile at (x*T, y*T) into the
// static terrain cache. Variation comes from the stable `hash` (no
// Math.random), so the board looks the same on every load. Floors stay
// mid-dark (L 16-22 %) and low-contrast so units, highlights and labels
// always win; the darkness layer (WS2) sits on top.
import { MAT } from '../palette';
import { hash } from './noise';
import type { Material } from './types';

/** Device-pixel line width for joints and seams: 1 px at 46 px tiles, 2 px at 92. */
export function hairline(T: number): number {
  return Math.max(1, Math.round(T / 46));
}

type Painter = (g: CanvasRenderingContext2D, x: number, y: number, T: number) => void;

const R = Math.round;

function marble(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
  const x0 = x * T;
  const y0 = y * T;
  const lw = hairline(T);
  g.fillStyle = (x + y) % 2 === 0 ? MAT.marble.a : MAT.marble.b;
  g.fillRect(x0, y0, T, T);
  // Soft cloud in the slab so the checker is not flat.
  g.fillStyle = 'rgba(255,255,255,0.018)';
  g.beginPath();
  g.ellipse(x0 + T * (0.3 + 0.4 * hash(x, y, 41)), y0 + T * (0.3 + 0.4 * hash(x, y, 42)), T * 0.3, T * 0.18, hash(x, y, 43) * 3, 0, Math.PI * 2);
  g.fill();
  // One bezier vein.
  g.strokeStyle = MAT.marble.vein;
  g.lineWidth = Math.max(1, T / 40);
  g.beginPath();
  const a = hash(x, y, 1) * T;
  g.moveTo(x0, y0 + a);
  g.bezierCurveTo(x0 + T * 0.3, y0 + a - T * 0.25, x0 + T * 0.62, y0 + hash(x, y, 2) * T, x0 + T, y0 + hash(x, y, 3) * T);
  g.stroke();
  g.fillStyle = MAT.marble.joint;
  g.fillRect(x0, y0, T, lw);
  g.fillRect(x0, y0, lw, T);
  g.fillStyle = 'rgba(255,255,255,0.035)';
  g.fillRect(x0 + lw, y0 + lw, T - lw, lw);
}

function well(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
  const x0 = x * T;
  const y0 = y * T;
  const n = 3;
  const s = T / n;
  const lw = hairline(T);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = hash(x * n + i, y * n + j, 5) < 0.5 ? MAT.well.a : MAT.well.b;
      const ax = R(x0 + i * s);
      const ay = R(y0 + j * s);
      g.fillRect(ax, ay, R(x0 + (i + 1) * s) - ax, R(y0 + (j + 1) * s) - ay);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < n; i++) {
    g.fillRect(R(x0 + i * s), y0, lw, T);
    g.fillRect(x0, R(y0 + i * s), T, lw);
  }
  // Glaze glint on the upper-left of each ceramic tile.
  g.fillStyle = 'rgba(190,240,255,0.04)';
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g.fillRect(R(x0 + i * s) + lw, R(y0 + j * s) + lw, R(s * 0.5), lw);
}

function plank(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
  const x0 = x * T;
  const y0 = y * T;
  const rows = 4;
  const ph = T / rows;
  const lw = hairline(T);
  for (let j = 0; j < rows; j++) {
    const py = R(y0 + j * ph);
    const pn = R(y0 + (j + 1) * ph) - py;
    g.fillStyle = hash(x, y * rows + j, 3) < 0.5 ? MAT.plank.a : MAT.plank.b;
    g.fillRect(x0, py, T, pn);
    // Wood grain: two faint streaks of varying length.
    g.fillStyle = 'rgba(0,0,0,0.13)';
    for (let k = 0; k < 2; k++) {
      const gx = hash(x, y * rows + j, 20 + k) * T * 0.6;
      const gl = T * (0.25 + 0.4 * hash(x, y * rows + j, 30 + k));
      g.fillRect(R(x0 + gx), py + R(pn * (0.35 + 0.3 * k)), R(gl), lw);
    }
    g.fillStyle = MAT.plank.seam;
    g.fillRect(x0, py, T, lw);
    const cut = ((x * 7 + j * 3) % 4) / 4;
    if (cut > 0) g.fillRect(R(x0 + cut * T), py, lw, pn);
    g.fillStyle = MAT.plank.sheen;
    g.fillRect(x0, py + lw, T, lw);
  }
}

function parquet(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
  const x0 = x * T;
  const y0 = y * T;
  const s = T / 2;
  const lw = hairline(T);
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const bx = R(x0 + i * s);
      const by = R(y0 + j * s);
      const bw = R(x0 + (i + 1) * s) - bx;
      const bh = R(y0 + (j + 1) * s) - by;
      const across = (i + j + x + y) % 2 === 0;
      g.fillStyle = across ? MAT.parquet.a : MAT.parquet.b;
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      for (let k = 1; k < 3; k++) {
        if (across) g.fillRect(bx, R(by + (k * bh) / 3), bw, lw);
        else g.fillRect(R(bx + (k * bw) / 3), by, lw, bh);
      }
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x0, y0, T, lw);
  g.fillRect(x0, y0, lw, T);
}

function boards(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
  const x0 = x * T;
  const y0 = y * T;
  const cols = 4;
  const pw = T / cols;
  const lw = hairline(T);
  for (let i = 0; i < cols; i++) {
    const bx = R(x0 + i * pw);
    const bw = R(x0 + (i + 1) * pw) - bx;
    g.fillStyle = hash(x * cols + i, y, 8) < 0.5 ? MAT.boards.a : MAT.boards.b;
    g.fillRect(bx, y0, bw, T);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(bx + R(bw * (0.3 + 0.4 * hash(x * cols + i, y, 12))), R(y0 + T * hash(x * cols + i, y, 13) * 0.5), lw, R(T * 0.4));
    g.fillStyle = MAT.plank.seam;
    g.fillRect(bx, y0, lw, T);
    // A butt joint on some boards.
    if (hash(x * cols + i, y, 14) < 0.35) g.fillRect(bx, R(y0 + T * (0.2 + 0.6 * hash(x * cols + i, y, 15))), bw, lw);
  }
}

function cobbleLike(g: CanvasRenderingContext2D, x: number, y: number, T: number, plaza: boolean): void {
  const x0 = x * T;
  const y0 = y * T;
  // Plaza setts sit in a shallow joint (a dark full-tile grid would read like a move grid).
  g.fillStyle = plaza ? '#22262f' : MAT.cobble.gap;
  g.fillRect(x0, y0, T, T);
  const n = plaza ? 2 : 3;
  const s = T / n;
  const gap = plaza ? Math.max(1, R(T / 60)) : Math.max(1, R(T / 30));
  g.save();
  g.beginPath();
  g.rect(x0, y0, T, T);
  g.clip();
  for (let j = 0; j < n; j++) {
    // Alternate rows of cobbles are offset half a stone (and wrap across the tile).
    const off = plaza ? 0 : ((y * n + j) % 2) * s * 0.5;
    for (let i = -1; i < n; i++) {
      const k = hash(x * n + i + (off > 0 ? 100 : 0), y * n + j, 9);
      const cx = x0 + i * s + off + s / 2;
      if (cx + s / 2 < x0 || cx - s / 2 > x0 + T) continue;
      const cy = y0 + j * s + s / 2;
      g.fillStyle = k < 0.5 ? MAT.cobble.a : MAT.cobble.b;
      g.beginPath();
      if (plaza) g.rect(R(cx - s / 2 + gap), R(cy - s / 2 + gap), R(s - 2 * gap), R(s - 2 * gap));
      else g.ellipse(cx, cy, s * 0.45 - gap * 0.5, s * 0.41 - gap * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      // Lit upper-left of each stone.
      g.fillStyle = 'rgba(200,215,255,0.045)';
      g.beginPath();
      if (plaza) g.rect(R(cx - s / 2 + gap), R(cy - s / 2 + gap), R(s - 2 * gap), Math.max(1, R(s * 0.16)));
      else g.ellipse(cx - s * 0.08, cy - s * 0.1, s * 0.24, s * 0.16, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

function tunnel(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
  const x0 = x * T;
  const y0 = y * T;
  const lw = hairline(T);
  g.fillStyle = hash(x, y) < 0.5 ? MAT.tunnel.a : MAT.tunnel.b;
  g.fillRect(x0, y0, T, T);
  // Rough stone: two irregular blocks per tile.
  g.fillStyle = 'rgba(255,255,255,0.025)';
  g.fillRect(x0 + lw, y0 + lw, R(T * (0.3 + 0.4 * hash(x, y, 4))) - lw, R(T * 0.45));
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x0, y0, T, lw);
  g.fillRect(x0 + R((0.3 + 0.4 * hash(x, y, 4)) * T), y0, lw, R(T * 0.5));
  g.fillRect(x0, y0 + R(T * 0.5), T, lw);
  g.fillRect(x0 + R((0.2 + 0.5 * hash(x, y, 5)) * T), y0 + R(T * 0.5), lw, T - R(T * 0.5));
  if (hash(x, y, 6) < 0.35) {
    g.fillStyle = MAT.tunnel.damp;
    g.beginPath();
    g.ellipse(x0 + T * (0.3 + hash(x, y, 7) * 0.4), y0 + T * (0.3 + hash(x, y, 8) * 0.4), T * 0.26, T * 0.13, 0, 0, Math.PI * 2);
    g.fill();
  }
}

function flag(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
  const x0 = x * T;
  const y0 = y * T;
  const lw = hairline(T);
  const half = R(T / 2);
  // Two courses of large flags per tile; the lower course is offset half a tile.
  g.fillStyle = hash(x, y, 1) < 0.5 ? MAT.flag.a : MAT.flag.b;
  g.fillRect(x0, y0, T, half);
  g.fillStyle = hash(x, y, 2) < 0.5 ? MAT.flag.a : MAT.flag.b;
  g.fillRect(x0, y0 + half, half, T - half);
  g.fillStyle = hash(x + 1, y, 2) < 0.5 ? MAT.flag.a : MAT.flag.b;
  g.fillRect(x0 + half, y0 + half, T - half, T - half);
  g.fillStyle = 'rgba(0,0,0,0.36)';
  g.fillRect(x0, y0, T, lw);
  g.fillRect(x0, y0, lw, half);
  g.fillRect(x0, y0 + half, T, lw);
  g.fillRect(x0 + half, y0 + half, lw, T - half);
  // Cold moonlit top edges.
  g.fillStyle = MAT.flag.moonEdge;
  g.fillRect(x0 + lw, y0 + lw, T - lw, lw);
  g.fillRect(x0, y0 + half + lw, T, lw);
  // Wear: a faint scuff.
  if (hash(x, y, 3) < 0.3) {
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.beginPath();
    g.ellipse(x0 + T * (0.3 + 0.4 * hash(x, y, 4)), y0 + T * (0.3 + 0.4 * hash(x, y, 5)), T * 0.18, T * 0.08, 0, 0, Math.PI * 2);
    g.fill();
  }
}

function slab(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
  const x0 = x * T;
  const y0 = y * T;
  const lw = hairline(T);
  g.fillStyle = hash(x, y) < 0.5 ? MAT.slab.a : MAT.slab.b;
  g.fillRect(x0, y0, T, T);
  if (hash(x, y, 2) < 0.4) {
    g.fillStyle = 'rgba(255,255,255,0.02)';
    g.fillRect(x0 + R(T * 0.15), y0 + R(T * 0.2), R(T * 0.5), R(T * 0.35));
  }
  g.fillStyle = MAT.slab.joint;
  g.fillRect(x0, y0, T, lw);
  g.fillRect(x0, y0, lw, T);
  g.fillStyle = 'rgba(255,255,255,0.025)';
  g.fillRect(x0 + lw, y0 + lw, T - lw, lw);
}

const PAINTERS: Readonly<Record<Material, Painter | null>> = {
  marble,
  well,
  plank,
  parquet,
  boards,
  plaza: (g, x, y, T) => cobbleLike(g, x, y, T, true),
  cobble: (g, x, y, T) => cobbleLike(g, x, y, T, false),
  tunnel,
  flag,
  slab,
  // Water and walls have their own painters in terrain.ts.
  canal: null,
  pool: null,
  wall: null,
};

/** Paints the floor of one tile for its material; false for canal, pool and wall (painted elsewhere). */
export function paintFloor(g: CanvasRenderingContext2D, m: Material, x: number, y: number, T: number): boolean {
  const p = PAINTERS[m];
  if (!p) return false;
  p(g, x, y, T);
  return true;
}

/** Materials that have a floor painter. */
export function hasFloorPainter(m: Material): boolean {
  return PAINTERS[m] !== null;
}
