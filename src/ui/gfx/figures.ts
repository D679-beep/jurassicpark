// Figure sprite painters and sprite cache (visual-style.md 5.1-5.4).
// Owner: WS3 (Figures & units). WS0 STUB: the pre-overhaul round token
// (shadow, gradient disc, Ascendant ring, glyph), moved here unchanged from
// renderer.ts and drawn directly each frame. WS3 replaces it with cached
// T x T figure sprites keyed `${faction}|${rank}|${character}|${variant}|${T}`
// (variants normal | shade | spent), evicted in UnitsPass.reset().
import type { Unit } from '../../engine';
import { unitGlyph } from '../hudModel';
import { FACTION_STYLE } from '../palette';

/** Pre-overhaul unit token centred at (cx, cy) with radius r. `minGlyph` = smallest glyph font in device px. */
export function paintLegacyToken(ctx: CanvasRenderingContext2D, u: Unit, cx: number, cy: number, r: number, T: number, minGlyph: number): void {
  const style = FACTION_STYLE[u.faction];
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
  ctx.font = `${named ? 800 : 700} ${Math.max(minGlyph, Math.round(T * (named ? 0.42 : 0.38)))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, cx, cy + T * 0.02);
}
