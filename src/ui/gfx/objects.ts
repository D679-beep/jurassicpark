// Barred doors, ward anchors and portcullis gates (visual-style.md 4.7, 10;
// layer 3), their lights (3.2) and the anchor core sparkle (layer 7).
// Owner: WS1 (Terrain & objects). WS0 STUB: the pre-overhaul door and anchor
// art, moved here unchanged from renderer.ts (object HP numbers moved to
// overlays.drawTopLabels, layer 12), plus a flat placeholder portcullis
// (closed grille / raised bar). WS1 replaces it per 4.7 and section 10.
// Gate state: closed when `!gate.open` or its id is in
// `overrides.closedGates`; rising while the `arrive` step of `gate.wave` is
// active (`f.input.active`).
import type { AnchorObject, DoorObject, GateObject } from '../../engine';
import { COLORS } from '../palette';
import { hash } from './noise';
import type { GfxFrame, ObjectsPass } from './types';

export function createObjects(): ObjectsPass {
  return {
    reset() {},
    clear() {},
    draw(f: GfxFrame) {
      for (const o of f.state.map.objects) {
        if (o.kind === 'door') drawDoor(f, o);
        else if (o.kind === 'anchor') drawAnchor(f, o);
        else if (o.kind === 'gate') drawGate(f, o);
      }
    },
    collectLights(_f: GfxFrame) {
      // WS1: ward-anchor lights (3.2).
    },
    drawSources(_f: GfxFrame) {
      // WS1: anchor core sparkle.
    },
  };
}

function drawDoor(f: GfxFrame, o: DoorObject): void {
  const { ctx, T } = f;
  const destroyed = o.destroyed && !f.input.overrides.intactObjects[o.id];
  const x0 = o.pos.x * T;
  const y0 = o.pos.y * T;
  if (destroyed) {
    ctx.fillStyle = COLORS.doorWoodDark;
    for (let i = 0; i < 3; i++) {
      const h = hash(o.pos.x, o.pos.y, i);
      ctx.fillRect(x0 + T * (0.15 + h * 0.6), y0 + T * (0.2 + i * 0.25), T * 0.22, T * 0.08);
    }
    return;
  }
  ctx.fillStyle = COLORS.doorWood;
  ctx.fillRect(x0 + T * 0.1, y0 + T * 0.1, T * 0.8, T * 0.8);
  ctx.strokeStyle = COLORS.doorWoodDark;
  ctx.lineWidth = Math.max(1, T / 18);
  ctx.strokeRect(x0 + T * 0.1, y0 + T * 0.1, T * 0.8, T * 0.8);
  // Iron bands and a heavy crossbar: reads as "barred", not as a marker.
  ctx.fillStyle = COLORS.doorIron;
  const band = Math.max(1, Math.round(T * 0.07));
  ctx.fillRect(x0 + T * 0.1, y0 + T * 0.24, T * 0.8, band);
  ctx.fillRect(x0 + T * 0.1, y0 + T * 0.62, T * 0.8, band);
  ctx.fillStyle = '#2b1a0c';
  ctx.fillRect(x0 + T * 0.02, y0 + T * 0.4, T * 0.96, Math.max(2, T * 0.14));
  ctx.fillStyle = COLORS.doorIron;
  ctx.fillRect(x0 + T * 0.02, y0 + T * 0.4, Math.max(1, T * 0.08), Math.max(2, T * 0.14));
  ctx.fillRect(x0 + T * 0.9, y0 + T * 0.4, Math.max(1, T * 0.08), Math.max(2, T * 0.14));
}

function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

function drawAnchor(f: GfxFrame, o: AnchorObject): void {
  const { ctx, T } = f;
  const destroyed = o.destroyed && !f.input.overrides.intactObjects[o.id];
  const x0 = o.pos.x * T;
  const y0 = o.pos.y * T;
  const cx = x0 + T / 2;
  const cy = y0 + T / 2;
  if (destroyed) {
    ctx.fillStyle = COLORS.anchorDead;
    diamond(ctx, cx, cy, T * 0.22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(1, T / 20);
    ctx.beginPath();
    ctx.moveTo(cx - T * 0.1, cy - T * 0.15);
    ctx.lineTo(cx + T * 0.05, cy + T * 0.15);
    ctx.stroke();
    return;
  }
  const pulse = 0.75 + 0.25 * Math.sin(f.now / 380 + o.pos.x);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, T * 0.7);
  glow.addColorStop(0, `rgba(170,215,255,${0.75 * pulse})`);
  glow.addColorStop(0.5, `rgba(110,120,255,${0.35 * pulse})`);
  glow.addColorStop(1, 'rgba(90,80,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x0 - T * 0.2, y0 - T * 0.2, T * 1.4, T * 1.4);
  ctx.fillStyle = COLORS.anchorCore;
  diamond(ctx, cx, cy, T * 0.2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,90,220,0.9)';
  ctx.lineWidth = Math.max(1, T / 20);
  ctx.stroke();
}

/** Placeholder portcullis: a full iron grille while closed, a raised bar at the top once open. */
function drawGate(f: GfxFrame, o: GateObject): void {
  const { ctx, T } = f;
  const closed = !o.open || f.input.overrides.closedGates[o.id] !== undefined;
  const bar = Math.max(1, Math.round(T * 0.08));
  ctx.fillStyle = '#4c525e';
  for (const t of o.tiles) {
    const x0 = t.x * T;
    const y0 = t.y * T;
    if (closed) {
      for (let i = 0; i < 5; i++) ctx.fillRect(x0 + Math.round(((i + 0.5) * T) / 5 - bar / 2), y0, bar, T);
      for (let j = 0; j < 3; j++) ctx.fillRect(x0, y0 + Math.round(((j + 0.5) * T) / 3 - bar / 2), T, bar);
    } else {
      ctx.fillRect(x0, y0, T, Math.max(2, Math.round(T * 0.14)));
    }
  }
}
