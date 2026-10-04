// Static terrain cache (visual-style.md 4.1-4.8 and 10; layer 1) and terrain
// light sources (layer 7).
// Owner: WS1 (Terrain & objects). WS0 STUB: the pre-overhaul terrain code,
// moved here unchanged from renderer.ts (flat walls, two-tone floors, baked
// lantern glows, dashed zone outlines, exit arrows), plus flat placeholder
// art for the new terrain kinds (table, crates, stairs, brazier, bell) so
// nothing breaks when the geometry pass places them. WS1 rewrites it from
// `f.sites` (materials, 2.5D walls, furniture per section 10, era
// desaturation baked when `f.era.t >= 1`), and removes the zone outlines
// (WS2 draws the hovered-zone outline, 4.9).
import { posKey, type GameState, type Pos, type Terrain } from '../../engine';
import { COLORS } from '../palette';
import { paintLegacyFloor } from './materials';
import { hash } from './noise';
import { OUTDOOR_ZONES } from './sites';
import type { GfxFrame, MapSites, TerrainPass } from './types';
import { paintLegacyWater } from './water';

export function createTerrain(): TerrainPass {
  let cache: HTMLCanvasElement | null = null;
  let cacheT = 0;
  let cacheSites: MapSites | null = null;
  let cacheBurn = '';

  return {
    reset() {
      cacheT = 0;
      cacheSites = null;
    },
    clear() {
      cacheBurn = '';
    },
    draw(f: GfxFrame) {
      const { state } = f;
      const unburned = Object.values(f.input.overrides.unburnedBridges).flat();
      let burn = '';
      for (const o of state.map.objects) if (o.kind === 'bridge' && o.burned) burn += `${o.id},`;
      burn += '|' + unburned.map(posKey).join(' ');
      if (!cache || cacheT !== f.T || cacheSites !== f.sites || cacheBurn !== burn) {
        cache = buildCache(cache, state, f.T, unburned);
        cacheT = f.T;
        cacheSites = f.sites;
        cacheBurn = burn;
      }
      if (cache) f.ctx.drawImage(cache, 0, 0);
    },
    drawSources(_f: GfxFrame) {
      // WS1: lantern cores, brazier fire, table candles above the darkness.
    },
  };
}

function buildCache(prev: HTMLCanvasElement | null, state: GameState, T: number, unburned: Pos[]): HTMLCanvasElement | null {
  const c = prev ?? document.createElement('canvas');
  c.width = T * state.map.width;
  c.height = T * state.map.height;
  const g = c.getContext('2d');
  if (!g) return null;
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
  return c;
}

// --- terrain drawing helpers (pre-overhaul look) -----------------------------------

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

function drawStones(g: CanvasRenderingContext2D, x: number, y: number, T: number, light: string, dark: string): void {
  const x0 = x * T;
  const y0 = y * T;
  for (let i = 0; i < 5; i++) {
    const hx = hash(x, y, i + 1);
    const hy = hash(x, y, i + 11);
    const s = T * (0.1 + hash(x, y, i + 21) * 0.14);
    g.fillStyle = i % 2 === 0 ? light : dark;
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
}

function drawColumn(g: CanvasRenderingContext2D, x: number, y: number, T: number, body: string, hi: string): void {
  const cx = x * T + T / 2;
  const cy = y * T + T / 2;
  g.fillStyle = COLORS.pillarShadow;
  g.beginPath();
  g.arc(cx + T * 0.06, cy + T * 0.08, T * 0.34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, T * 0.32, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = hi;
  g.beginPath();
  g.arc(cx - T * 0.09, cy - T * 0.09, T * 0.12, 0, Math.PI * 2);
  g.fill();
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
      paintLegacyFloor(g, x, y, T, outdoor);
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
      paintLegacyFloor(g, x, y, T, outdoor);
      g.fillStyle = COLORS.doorWood;
      g.fillRect(x0 + T * 0.12, y0 + T * 0.12, T * 0.76, T * 0.76);
      g.fillStyle = COLORS.doorWoodDark;
      g.fillRect(x0 + T * 0.48, y0 + T * 0.12, Math.max(1, T * 0.04), T * 0.76);
      g.fillStyle = COLORS.lantern;
      g.fillRect(x0 + T * 0.38, y0 + T * 0.48, Math.max(1, T * 0.07), Math.max(1, T * 0.07));
      g.fillRect(x0 + T * 0.56, y0 + T * 0.48, Math.max(1, T * 0.07), Math.max(1, T * 0.07));
      break;
    case 'rubble':
      paintLegacyFloor(g, x, y, T, outdoor);
      drawStones(g, x, y, T, COLORS.rubble, COLORS.rubbleDark);
      break;
    case 'crates':
      // Placeholder (WS1: section 10 crates): rubble shapes in crate wood.
      paintLegacyFloor(g, x, y, T, outdoor);
      drawStones(g, x, y, T, '#6a4b2c', '#3e2a17');
      break;
    case 'table':
      // Placeholder (WS1: section 10 tables): a flat dark-wood top.
      paintLegacyFloor(g, x, y, T, outdoor);
      g.fillStyle = COLORS.doorWoodDark;
      g.fillRect(x0 + T * 0.08, y0 + T * 0.18, T * 0.84, T * 0.58);
      g.fillStyle = COLORS.doorWood;
      g.fillRect(x0 + T * 0.08, y0 + T * 0.18, T * 0.84, Math.max(1, T * 0.06));
      break;
    case 'stairs':
      // Placeholder (WS1: section 10 steps): floor with tread lines.
      paintLegacyFloor(g, x, y, T, outdoor);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 1; i < 4; i++) g.fillRect(x0, y0 + (i * T) / 4, T, Math.max(1, T / 24));
      break;
    case 'water':
      paintLegacyWater(g, x, y, T);
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
      paintLegacyWater(g, x, y, T);
      const horizontalCanal =
        terrainAtXY(state, x - 1, y) === 'water' || terrainAtXY(state, x + 1, y) === 'water' || terrainAtXY(state, x - 1, y) === 'wall';
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
    case 'pillar':
      paintLegacyFloor(g, x, y, T, outdoor);
      drawColumn(g, x, y, T, COLORS.pillar, COLORS.pillarHi);
      break;
    case 'brazier':
      // Placeholder (WS1: section 10 brazier): a column with a glowing bowl.
      paintLegacyFloor(g, x, y, T, outdoor);
      drawColumn(g, x, y, T, '#2a1f18', '#7a6650');
      g.fillStyle = COLORS.ember;
      g.beginPath();
      g.arc(x0 + T / 2, y0 + T / 2, T * 0.14, 0, Math.PI * 2);
      g.fill();
      break;
    case 'bell':
      // Placeholder (WS1: section 10 great bell): a bronze disc.
      paintLegacyFloor(g, x, y, T, outdoor);
      drawColumn(g, x, y, T, '#9c7a3c', '#e0bd72');
      break;
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
  g.strokeStyle = COLORS.zoneLine;
  g.lineWidth = Math.max(1, Math.round(T / 24));
  g.setLineDash([Math.max(2, T / 6), Math.max(2, T / 6)]);
  for (const tiles of Object.values(state.map.zones)) {
    const set = new Set(tiles.map(posKey));
    g.beginPath();
    for (const p of tiles) outlineEdges(g, p, T, (q) => set.has(posKey(q)));
    g.stroke();
  }
  g.setLineDash([]);
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
