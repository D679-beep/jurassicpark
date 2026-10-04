// Canvas status-badge painters (visual-style.md 5.5: sealed, dueling,
// drained, escapee; crossed swords, padlock, cracked drop, arrow out).
// Owner: WS3 (Figures & units). WS0 STUB: the pre-overhaul markers (a red X
// for dueling, a dashed ring + padlock for sealed, a grey triangle for
// drained), moved here unchanged from renderer.ts. WS3 replaces them with
// round badges at the top right; the dueling badge must be crossed swords,
// never an X.
import type { Pos, Unit } from '../../engine';

/** Pre-overhaul status markers for a unit drawn at tile `p` (device px tile `T`), token centre (cx, cy), radius r. */
export function paintLegacyStatus(ctx: CanvasRenderingContext2D, u: Unit, p: Pos, T: number, cx: number, cy: number, r: number): void {
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
}
