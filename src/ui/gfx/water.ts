// Canal and reflecting-pool per-frame pass (visual-style.md 4.6, 10; layer 2).
// Owner: WS1 (Terrain & objects). WS0 STUB: the canal is still the
// pre-overhaul static water baked into the terrain cache (`paintLegacyWater`,
// used by terrain.ts), so the per-frame pass draws nothing. WS1 adds the
// surface band, ripples, reflection streaks (sites.reflections), the bank
// line and the pool shimmer here; intact bridge tiles (WaterTile.bridge not
// burned, or listed in overrides.unburnedBridges) are skipped.
import { COLORS } from '../palette';
import { hash } from './noise';
import type { GfxFrame, WaterPass } from './types';

/** Pre-overhaul water tile: flat blue with two sine wavelets. */
export function paintLegacyWater(g: CanvasRenderingContext2D, x: number, y: number, T: number): void {
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

export function createWater(): WaterPass {
  return {
    reset() {},
    clear() {},
    draw(_f: GfxFrame) {
      // WS1: ripples, reflections, pool shimmer.
    },
  };
}
