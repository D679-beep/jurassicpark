// Floor painters per Material (visual-style.md 4.1, 1.2).
// Owner: WS1 (Terrain & objects). WS0 STUB: still the pre-overhaul two-tone
// floor (indoor / outdoor), moved here unchanged from renderer.ts. WS1
// replaces it with one painter per `Material` (marble, well, plank, ...),
// driven by `sites.material[y][x]`.
import { COLORS } from '../palette';
import { hash } from './noise';

/** Pre-overhaul floor tile: checker by hash, 1 px seams, faint outdoor scuffs. */
export function paintLegacyFloor(g: CanvasRenderingContext2D, x: number, y: number, T: number, outdoor: boolean): void {
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
