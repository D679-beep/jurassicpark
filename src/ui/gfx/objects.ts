// Barred doors, ward anchors and portcullis gates (visual-style.md 4.7, 10;
// layer 3), their lights (3.2) and the anchor core sparkle (layer 7).
// Owner: WS1 (Terrain & objects). HP numbers are overlays (layer 12).
//   - Barred door: intact -> cracked (< 75 % HP) -> damaged (< 50 %:
//     crossbar knocked askew, more cracks) -> broken (destroyed: splinters
//     against the jambs, floor visible). Display HP = overrides.hp ?? hp;
//     a destroyed door listed in overrides.intactObjects still looks intact.
//   - Ward anchor: floating crystal (cached sprite) over a rune ellipse,
//     bobbing unless motion.reduced; damaged = cracked + stronger flicker;
//     destroyed = dull shards, dim rune, no light.
//   - Portcullis: closed (`!open` or listed in overrides.closedGates),
//     rising while the `arrive` step of its wave plays (p 0-0.5,
//     easeOutCubic, clipped at the top of each gate tile), open (only the
//     raised grille's bottom edge shows).
import type { AnchorObject, DoorObject, GateObject } from '../../engine';
import { ANCHOR, DOOR, GATE, LIGHT, WALL } from '../palette';
import { clamp01, easeOutCubic } from './ease';
import { hash, hashString } from './noise';
import type { Axis, Dir, GfxFrame, LightSource, MapSites, ObjectsPass } from './types';

const R = Math.round;
const TAU = Math.PI * 2;

export type DoorStage = 'intact' | 'cracked' | 'damaged' | 'broken';

/** Barred-door look for a displayed HP (4.7: damaged below 50 %). */
export function doorStage(hp: number, maxHp: number, destroyed: boolean, intactOverride: boolean): DoorStage {
  if (destroyed && !intactOverride) return 'broken';
  const r = maxHp > 0 ? hp / maxHp : 1;
  if (r < 0.5) return 'damaged';
  if (r < 0.75) return 'cracked';
  return 'intact';
}

/** Number of dark cracks on a barred door / anchor by HP ratio. */
export function crackCount(hp: number, maxHp: number): number {
  const r = maxHp > 0 ? hp / maxHp : 1;
  return r >= 0.75 ? 0 : r >= 0.5 ? 1 : r >= 0.25 ? 2 : 3;
}

/**
 * How far a portcullis is raised: 0 closed, 1 open, in between while the
 * `arrive` step of its wave plays (p 0-0.5, easeOutCubic).
 */
export function gateRise(
  gate: Pick<GateObject, 'id' | 'wave' | 'open'>,
  closedGates: Readonly<Record<string, string>>,
  active: { step: { kind: string; event: { type: string; waveId?: string } }; progress: number } | null,
): number {
  if (!gate.open || closedGates[gate.id] !== undefined) return 0;
  if (active && active.step.kind === 'arrive' && active.step.event.type === 'reinforcementsArrived' && active.step.event.waveId === gate.wave) {
    return easeOutCubic(clamp01(active.progress / 0.5));
  }
  return 1;
}

export function createObjects(): ObjectsPass {
  let spritesT = 0;
  let crystal: HTMLCanvasElement | null = null;
  let crystalCracked: HTMLCanvasElement | null = null;
  let sparkle: HTMLCanvasElement | null = null;
  let doorAxis = new Map<string, Axis>();
  let gateInfo = new Map<string, { outward: Dir }>();
  let infoSites: MapSites | null = null;
  const anchorLights = new Map<string, LightSource>();

  const ensure = (f: GfxFrame): void => {
    if (spritesT !== f.T) {
      spritesT = f.T;
      crystal = makeCrystal(f.T, false);
      crystalCracked = makeCrystal(f.T, true);
      sparkle = makeSparkle(f.T);
    }
    if (infoSites !== f.sites) {
      infoSites = f.sites;
      doorAxis = new Map();
      for (const d of f.sites.doors) if (d.objectId) doorAxis.set(d.objectId, d.axis);
      gateInfo = new Map();
      for (const g of f.sites.gates) gateInfo.set(g.id, { outward: g.outward });
    }
  };

  return {
    reset() {
      spritesT = 0;
      infoSites = null;
    },
    clear() {
      anchorLights.clear();
    },
    draw(f: GfxFrame) {
      ensure(f);
      const ov = f.input.overrides;
      for (const o of f.state.map.objects) {
        if (o.kind === 'door') drawDoor(f, o, doorAxis.get(o.id) ?? 'ns', ov.hp[o.id] ?? o.hp, !!ov.intactObjects[o.id]);
        else if (o.kind === 'anchor') drawAnchor(f, o, ov.hp[o.id] ?? o.hp, !!ov.intactObjects[o.id], crystal, crystalCracked);
        else if (o.kind === 'gate') {
          const rise = gateRise(o, ov.closedGates, f.input.active);
          drawGate(f, o, rise, gateInfo.get(o.id)?.outward ?? { dx: 0, dy: 1 });
        }
      }
    },
    collectLights(f: GfxFrame) {
      const ov = f.input.overrides;
      for (const o of f.state.map.objects) {
        if (o.kind !== 'anchor') continue;
        if (o.destroyed && !ov.intactObjects[o.id]) continue;
        const hp = ov.hp[o.id] ?? o.hp;
        let l = anchorLights.get(o.id);
        if (!l) {
          l = { kind: 'anchor', x: 0, y: 0, radius: 2, intensity: 0.7, color: LIGHT.ward, flicker: 0.12, seed: hashString(o.id), lamp: false };
          anchorLights.set(o.id, l);
        }
        l.x = o.pos.x + 0.5;
        l.y = o.pos.y + 0.45;
        l.intensity = f.motion.reduced ? 0.7 : 0.7 * (0.85 + 0.15 * Math.sin(f.now / 520 + l.seed * TAU));
        l.flicker = hp / Math.max(1, o.maxHp) < 0.5 ? 0.25 : 0.12;
        f.lights.push(l);
      }
    },
    drawSources(f: GfxFrame) {
      ensure(f);
      if (!sparkle) return;
      const { ctx, T } = f;
      const ov = f.input.overrides;
      const ss = sparkle.width;
      for (const o of f.state.map.objects) {
        if (o.kind !== 'anchor' || (o.destroyed && !ov.intactObjects[o.id])) continue;
        const cx = o.pos.x * T + T / 2;
        const cy = o.pos.y * T + anchorCrystalY(f, o);
        const tw = f.motion.reduced ? 0.85 : 0.7 + 0.3 * Math.sin(f.now / 260 + hashString(o.id) * 20);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = tw;
        ctx.drawImage(sparkle, R(cx - ss / 2), R(cy - ss / 2));
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = ANCHOR.hi;
        const c = Math.max(1, R(T * 0.05));
        ctx.fillRect(R(cx - c / 2), R(cy - c / 2 - T * 0.04), c, c);
      }
    },
  };
}

// --- barred doors ------------------------------------------------------------------------

function drawDoor(f: GfxFrame, o: DoorObject, axis: Axis, hp: number, intactOverride: boolean): void {
  const { ctx, T } = f;
  const stage = doorStage(hp, o.maxHp, o.destroyed, intactOverride);
  const lw = Math.max(1, R(T / 46));
  const x0 = o.pos.x * T;
  const y0 = o.pos.y * T;
  ctx.save();
  // Local frame: jambs on the wall sides. For 'ew' passages (walls N/S) jambs are top/bottom;
  // for 'ns' passages (walls W/E) rotate a quarter turn so the jambs sit left/right.
  ctx.translate(x0 + T / 2, y0 + T / 2);
  const rotated = axis === 'ns';
  const jamb = R(T * 0.1);
  const h = T / 2;
  const jamb0 = (): void => {
    ctx.fillStyle = WALL.cap;
    if (rotated) {
      ctx.fillRect(-h, -h, jamb, T);
      ctx.fillRect(h - jamb, -h, jamb, T);
      ctx.fillStyle = WALL.capRim;
      ctx.fillRect(-h + jamb - lw, -h, lw, T);
      ctx.fillRect(h - jamb, -h, lw, T);
    } else {
      ctx.fillRect(-h, -h, T, jamb);
      ctx.fillRect(-h, h - jamb, T, jamb);
      ctx.fillStyle = WALL.capRim;
      ctx.fillRect(-h, -h + jamb - lw, T, lw);
      ctx.fillRect(-h, h - jamb, T, lw);
    }
  };
  if (stage === 'broken') {
    jamb0();
    // Four splinters against the jambs; the floor and the threshold (terrain cache) show through.
    ctx.fillStyle = DOOR.woodDark;
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? -1 : 1;
      const along = (i % 2 === 0 ? -0.22 : 0.18) * T + (hash(o.pos.x, o.pos.y, 300 + i) - 0.5) * T * 0.12;
      const len = T * (0.16 + 0.1 * hash(o.pos.x, o.pos.y, 310 + i));
      const wid = T * 0.07;
      ctx.beginPath();
      if (rotated) {
        const bx = side * (h - jamb);
        ctx.moveTo(bx, along - wid);
        ctx.lineTo(bx - side * len, along + wid * 0.2);
        ctx.lineTo(bx, along + wid);
      } else {
        const by = side * (h - jamb);
        ctx.moveTo(along - wid, by);
        ctx.lineTo(along + wid * 0.2, by - side * len);
        ctx.lineTo(along + wid, by);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = DOOR.wood;
    for (let i = 0; i < 2; i++) {
      const px = (hash(o.pos.x, o.pos.y, 320 + i) - 0.5) * T * 0.5;
      const py = (hash(o.pos.x, o.pos.y, 330 + i) - 0.5) * T * 0.5;
      ctx.fillRect(R(px), R(py), R(T * 0.12), Math.max(1, R(T * 0.04)));
    }
    ctx.restore();
    return;
  }
  // Closed leaves: 0.92T across the passage x 0.80T between the jambs.
  const lwid = rotated ? T * 0.8 : T * 0.92;
  const lhei = rotated ? T * 0.92 : T * 0.8;
  const l = R(-lwid / 2);
  const t = R(-lhei / 2);
  const W = R(lwid);
  const H = R(lhei);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(l + R(T * 0.04), t + R(T * 0.05), W, H);
  ctx.fillStyle = DOOR.wood;
  ctx.fillRect(l, t, W, H);
  // Vertical planks and the seam between the two leaves.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  for (let k = 1; k < 6; k++) ctx.fillRect(R(l + (W * k) / 6), t, lw, H);
  ctx.fillStyle = DOOR.woodDark;
  ctx.fillRect(R(-lw), t, lw * 2, H);
  ctx.fillStyle = 'rgba(255,220,170,0.14)';
  ctx.fillRect(l, t, W, lw);
  ctx.strokeStyle = DOOR.woodDark;
  ctx.lineWidth = Math.max(1, R(T / 30));
  ctx.strokeRect(l + 0.5, t + 0.5, W - 1, H - 1);
  jamb0();
  // Two iron bands with rivets.
  const band = Math.max(1, R(T * 0.07));
  for (const fy of [0.2, 0.74]) {
    const by = R(t + H * fy - band / 2);
    ctx.fillStyle = '#4a4f58';
    ctx.fillRect(l, by, W, band);
    ctx.fillStyle = DOOR.iron;
    ctx.fillRect(l, by, W, lw);
    ctx.fillStyle = '#c8cdd6';
    for (let k = 0; k < 4; k++) ctx.fillRect(R(l + W * (0.12 + 0.25 * k)), by + R(band / 2) - lw / 2, lw, lw);
  }
  // Cracks by HP ratio.
  const cracks = stage === 'intact' ? 0 : crackCount(hp, o.maxHp);
  if (cracks > 0) {
    ctx.strokeStyle = 'rgba(10,6,3,0.9)';
    ctx.lineWidth = Math.max(1, R(T / 26));
    ctx.lineJoin = 'miter';
    for (let i = 0; i < cracks; i++) {
      const sx = l + W * (0.18 + 0.3 * i + 0.1 * hash(o.pos.x, o.pos.y, 340 + i));
      const sy = t + H * (i % 2 === 0 ? 0.04 : 0.96);
      const dir = i % 2 === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      for (let k = 1; k <= 3; k++) {
        ctx.lineTo(sx + (hash(o.pos.x, o.pos.y, 350 + i * 4 + k) - 0.5) * T * 0.16, sy + dir * H * 0.15 * k);
      }
      ctx.stroke();
    }
    ctx.lineJoin = 'miter';
  }
  // Heavy crossbar with iron ends (knocked askew when damaged).
  ctx.save();
  if (stage === 'damaged') ctx.rotate(-0.18);
  const bh = Math.max(2, R(T * 0.14));
  const bw = R(T * 0.98);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-R(bw / 2) + lw, -R(bh / 2) + R(T * 0.04), bw, bh);
  ctx.fillStyle = DOOR.bar;
  ctx.fillRect(-R(bw / 2), -R(bh / 2), bw, bh);
  ctx.fillStyle = 'rgba(255,220,170,0.18)';
  ctx.fillRect(-R(bw / 2), -R(bh / 2), bw, lw);
  ctx.fillStyle = DOOR.iron;
  const cap = Math.max(1, R(T * 0.08));
  ctx.fillRect(-R(bw / 2), -R(bh / 2), cap, bh);
  ctx.fillRect(R(bw / 2) - cap, -R(bh / 2), cap, bh);
  ctx.restore();
  ctx.restore();
}

// --- ward anchors ---------------------------------------------------------------------------

function anchorCrystalY(f: GfxFrame, o: AnchorObject): number {
  const bob = f.motion.reduced ? 0 : 0.03 * Math.sin((f.now / 3300) * TAU + hashString(o.id) * TAU);
  return f.T * (0.4 + bob);
}

function drawAnchor(f: GfxFrame, o: AnchorObject, hp: number, intactOverride: boolean, crystal: HTMLCanvasElement | null, cracked: HTMLCanvasElement | null): void {
  const { ctx, T } = f;
  const x0 = o.pos.x * T;
  const y0 = o.pos.y * T;
  const cx = x0 + T / 2;
  const fy = y0 + T * 0.76;
  const lw = Math.max(1, R(T / 30));
  if (o.destroyed && !intactOverride) {
    ctx.strokeStyle = 'rgba(90,100,140,0.35)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.ellipse(cx, fy, T * 0.34, T * 0.13, 0, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + hash(o.pos.x, o.pos.y, 400) * 2;
      const sx = cx + Math.cos(a) * T * 0.16;
      const sy = fy - T * 0.04 + Math.sin(a) * T * 0.07;
      const s = T * (0.07 + 0.04 * hash(o.pos.x, o.pos.y, 401 + i));
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.moveTo(sx - s + lw, sy + lw);
      ctx.lineTo(sx + lw, sy - s * 1.3 + lw);
      ctx.lineTo(sx + s * 0.8 + lw, sy + s * 0.2 + lw);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ANCHOR.dead;
      ctx.beginPath();
      ctx.moveTo(sx - s, sy);
      ctx.lineTo(sx, sy - s * 1.3);
      ctx.lineTo(sx + s * 0.8, sy + s * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(200,210,255,0.15)';
      ctx.fillRect(R(sx - s * 0.4), R(sy - s * 0.6), lw, lw);
    }
    return;
  }
  // Rune ellipse on the floor and a small shadow under the floating crystal.
  ctx.strokeStyle = 'rgba(140,180,255,0.65)';
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.ellipse(cx, fy, T * 0.34, T * 0.13, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(140,180,255,0.6)';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ctx.fillRect(R(cx + Math.cos(a) * T * 0.34 - lw), R(fy + Math.sin(a) * T * 0.13 - lw), lw * 2, lw * 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(cx, fy, T * 0.12, T * 0.045, 0, 0, TAU);
  ctx.fill();
  const sp = hp / Math.max(1, o.maxHp) < 0.5 ? cracked : crystal;
  if (sp) {
    const cy = y0 + anchorCrystalY(f, o);
    ctx.drawImage(sp, R(cx - sp.width / 2), R(cy - sp.height / 2));
  }
}

function makeCrystal(T: number, cracked: boolean): HTMLCanvasElement {
  const w = Math.max(6, R(T * 0.34));
  const h = Math.max(8, R(T * 0.48));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  if (!g) return cv;
  const cw = T * 0.3;
  const ch = T * 0.44;
  const cx = w / 2;
  const cy = h / 2;
  const path = (): void => {
    g.beginPath();
    g.moveTo(cx, cy - ch / 2);
    g.lineTo(cx + cw / 2, cy - ch * 0.08);
    g.lineTo(cx, cy + ch / 2);
    g.lineTo(cx - cw / 2, cy - ch * 0.08);
    g.closePath();
  };
  const grad = g.createLinearGradient(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2);
  grad.addColorStop(0, ANCHOR.hi);
  grad.addColorStop(1, ANCHOR.lo);
  path();
  g.fillStyle = grad;
  g.fill();
  // Facet: darker right half.
  g.fillStyle = 'rgba(40,50,160,0.28)';
  g.beginPath();
  g.moveTo(cx, cy - ch / 2);
  g.lineTo(cx + cw / 2, cy - ch * 0.08);
  g.lineTo(cx, cy + ch / 2);
  g.closePath();
  g.fill();
  g.strokeStyle = ANCHOR.edge;
  g.lineWidth = Math.max(1, T / 30);
  path();
  g.stroke();
  if (cracked) {
    g.strokeStyle = 'rgba(10,12,40,0.9)';
    g.lineWidth = Math.max(1, T / 30);
    g.beginPath();
    g.moveTo(cx - cw * 0.3, cy - ch * 0.3);
    g.lineTo(cx + cw * 0.05, cy - ch * 0.05);
    g.lineTo(cx - cw * 0.08, cy + ch * 0.12);
    g.lineTo(cx + cw * 0.22, cy + ch * 0.32);
    g.stroke();
  }
  return cv;
}

function makeSparkle(T: number): HTMLCanvasElement {
  const s = Math.max(6, R(T * 0.5));
  const cv = document.createElement('canvas');
  cv.width = s;
  cv.height = s;
  const g = cv.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(230,248,255,0.9)');
    grad.addColorStop(0.3, 'rgba(140,180,255,0.35)');
    grad.addColorStop(1, 'rgba(120,170,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }
  return cv;
}

// --- portcullis ----------------------------------------------------------------------------

function drawGate(f: GfxFrame, o: GateObject, rise: number, outward: Dir): void {
  const { ctx, T } = f;
  const bar = Math.max(2, R(T * 0.08));
  const hi = Math.max(1, R(T / 46));
  const sh = R(T * 0.1);
  const lift = rise * T * 0.76;
  for (const t of o.tiles) {
    const x0 = t.x * T;
    const y0 = t.y * T;
    // Shadow of the grille on the outward side (closed) or under its raised edge (open).
    ctx.fillStyle = GATE.shadow;
    if (rise < 1) {
      if (outward.dy > 0) ctx.fillRect(x0, y0 + T - sh, T, sh);
      else if (outward.dy < 0) ctx.fillRect(x0, y0, T, sh);
      else if (outward.dx > 0) ctx.fillRect(x0 + T - sh, y0, sh, T);
      else ctx.fillRect(x0, y0, sh, T);
    }
    ctx.globalAlpha = rise;
    ctx.fillRect(x0, y0 + R(T * 0.14), T, R(T * 0.08));
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, T, T);
    ctx.clip();
    ctx.translate(0, -R(lift));
    // Three horizontal bars behind five vertical bars with spiked feet.
    ctx.fillStyle = '#2c3038';
    for (let j = 0; j < 3; j++) ctx.fillRect(x0, R(y0 + ((j + 0.5) * T * 0.86) / 3 - bar / 2), T, bar);
    ctx.fillStyle = GATE.ironHi;
    for (let j = 0; j < 3; j++) ctx.fillRect(x0, R(y0 + ((j + 0.5) * T * 0.86) / 3 - bar / 2), T, hi);
    for (let i = 0; i < 5; i++) {
      const bx = R(x0 + ((i + 0.5) * T) / 5 - bar / 2);
      ctx.fillStyle = GATE.iron;
      ctx.fillRect(bx, y0, bar, R(T * 0.86));
      ctx.fillStyle = GATE.ironHi;
      ctx.fillRect(bx, y0, hi, R(T * 0.86));
      ctx.fillStyle = GATE.iron;
      ctx.beginPath();
      ctx.moveTo(bx - hi, y0 + R(T * 0.86));
      ctx.lineTo(bx + bar / 2, y0 + T);
      ctx.lineTo(bx + bar + hi, y0 + R(T * 0.86));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
