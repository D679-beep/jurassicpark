// Per-frame unit pass (visual-style.md 5.5, 3.5; layer 10) and unit lights
// (seal, Radiant orb; 3.2).
// Owner: WS3 (Figures & units). WS0 STUB: the pre-overhaul unit drawing,
// moved here unchanged from renderer.ts (selection square, round token,
// legacy status markers, HP bar, death/remove fade of ghosts). It already
// reads the frame contract: `f.units` (display list), `f.poses` (offset and
// alpha only) so fx can drive it. WS3 replaces it: y-sort, figure sprites
// (figures.ts), night shade from `f.levelAt`, badges (badges.ts), HP ghost,
// idle bob unless `f.motion.reduced`. The legacy ghost fade below goes away
// with WS3: death/remove visuals come from fx poses (see types.ts rules).
import { COLORS, hpColor } from '../palette';
import { paintLegacyStatus } from './badges';
import { paintLegacyToken } from './figures';
import { IDENTITY_POSE, type DisplayUnit, type GfxFrame, type UnitsPass } from './types';

export function createUnits(): UnitsPass {
  return {
    reset() {},
    clear() {},
    collectLights(_f: GfxFrame) {
      // WS3: seal and Radiant-orb lights.
    },
    draw(f: GfxFrame) {
      for (const du of f.units) drawUnit(f, du);
    },
  };
}

function drawUnit(f: GfxFrame, du: DisplayUnit): void {
  const { ctx, T, state } = f;
  const u = du.unit;
  let alpha = 1;
  let scale = 1;
  const a = f.input.active;
  if (du.ghost && a && 'unitId' in a.step.event && a.step.event.unitId === u.id && (a.step.kind === 'death' || a.step.kind === 'remove')) {
    alpha = 1 - a.progress;
    scale = a.step.kind === 'death' ? 1 - 0.3 * a.progress : 1 + 0.2 * a.progress;
  } else if (!du.ghost && u.faction === state.activeFaction && !state.gameOver) {
    if (u.hasMoved && u.hasActed) alpha = 0.42;
    else if (u.hasActed) alpha = 0.72;
  }
  const pose = f.poses.get(u.id) ?? IDENTITY_POSE;
  alpha *= pose.alpha;
  scale *= pose.scale;
  const p = { x: du.pos.x + pose.dx, y: du.pos.y + pose.dy };
  const cx = (p.x + 0.5) * T;
  const cy = (p.y + 0.46) * T;
  const r = T * 0.34 * scale;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  if (du.selected) {
    const k = 0.5 + 0.5 * Math.sin(f.now / 160);
    ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.45 * k})`;
    ctx.lineWidth = Math.max(1.5, T / 12);
    ctx.strokeRect(p.x * T + 1.5, p.y * T + 1.5, T - 3, T - 3);
  }

  paintLegacyToken(ctx, u, cx, cy, r, T, f.px(8));
  paintLegacyStatus(ctx, u, p, T, cx, cy, r);

  // HP bar.
  hpBar(f, p.x * T + T * 0.12, (p.y + 1) * T - Math.max(3, Math.round(T * 0.12)) - 1, T * 0.76, du.hp, u.maxHp);
  ctx.restore();
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
