// Step effects, poses, screen shake, decals, floats, banner (visual-style.md
// section 6; layers 4a, 14, 15).
// Owner: WS4 (FX, Domains, animation). WS0 STUB: the pre-overhaul effect
// drawing (floats, pulses, tile flashes, banner card), moved here unchanged
// from renderer.ts; the controller still spawns `Effect`s in
// `spawnEffects`. Poses, shake, decals, particles and step hooks are no-ops.
// WS4 owns this file and `Effect` (types.ts imports the type from here), may
// extend `Effect`, and moves effect spawning out of the controller into
// onStepStart as it sees fit. Lifetimes / particle budgets / shake scale
// come from settings.ts helpers (effectLifeScale, burstLimit, shakeScale...).
import type { Pos } from '../../engine';
import { COLORS } from '../palette';
import type { AnimStep } from '../animation';
import type { FxPass, FxStepContext, GfxFrame } from './types';

export type Effect =
  | { kind: 'float'; pos: Pos; text: string; color: string; start: number; life: number }
  | { kind: 'pulse'; center: Pos; radius: number; color: string; start: number; life: number }
  | { kind: 'flash'; tiles: Pos[]; color: string; start: number; life: number }
  | { kind: 'banner'; title: string; subtitle: string; color: string; start: number; life: number };

export function createFx(): FxPass {
  const noShake = { x: 0, y: 0 };
  return {
    reset() {},
    clear() {},
    onStepStart(_step: AnimStep, _c: FxStepContext) {},
    onStepEnd(_step: AnimStep, _c: FxStepContext) {},
    computePoses(_f: GfxFrame) {},
    shakeOffset(_f: GfxFrame) {
      return noShake;
    },
    drawDecals(_f: GfxFrame) {},
    collectLights(_f: GfxFrame) {},
    draw(f: GfxFrame) {
      drawEffects(f);
    },
    drawBanner(f: GfxFrame) {
      for (const e of f.input.effects) {
        if (e.kind !== 'banner') continue;
        const t = Math.max(0, Math.min(1, (f.now - e.start) / e.life));
        if (t < 1) drawBanner(f, e.title, e.subtitle, e.color, t);
      }
    },
  };
}

function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

function drawEffects(f: GfxFrame): void {
  const { ctx, T } = f;
  for (const e of f.input.effects) {
    const t = Math.max(0, Math.min(1, (f.now - e.start) / e.life));
    if (t >= 1) continue;
    switch (e.kind) {
      case 'float': {
        const cx = (e.pos.x + 0.5) * T;
        const cy = (e.pos.y + 0.3) * T - t * T * 0.8;
        ctx.globalAlpha = 1 - t * t;
        ctx.font = `800 ${Math.max(f.px(13), Math.round(T * 0.52))}px system-ui, sans-serif`;
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
        break; // layer 15, drawBanner()
    }
  }
}

function drawBanner(f: GfxFrame, title: string, subtitle: string, color: string, t: number): void {
  const { ctx } = f;
  const W = f.width;
  const H = f.height;
  const fade = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
  const bh = Math.round(Math.max(f.px(56), Math.min(H * 0.24, f.T * 3.2)));
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
