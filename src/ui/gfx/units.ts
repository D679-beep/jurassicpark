// Per-frame unit pass (visual-style.md 5.5, 3.5; layer 10) and unit lights
// (seal, Radiant orb; 3.2).
// Owner: WS3 (Figures & units).
//
// Two passes over the y-sorted display list so HP bars, badges and tabs are
// never covered by another unit (checklist 11):
//   A. figures: selection glow, ground sprite (shadow + plate), sealed ring,
//      body sprite (bob, facing), night shade, impact flash; pose transforms
//      (dx/dy, scale and tilt about the feet, dissolve clip, alpha).
//   B. overlays: selection brackets, initial tab, status badges, HP bar
//      (with the damage ghost and heal flash). Never flipped or tilted.
// Sprites come from figures.ts / badges.ts caches (keyed by T and dpr,
// dropped on reset). Death/capture/escape visuals belong to fx: ghosts are
// drawn with whatever pose fx wrote (no fade of our own).
import type { Faction, Unit } from '../../engine';
import { unitGlyph } from '../hudModel';
import { HP, LIGHT, STATUS, hpColor } from '../palette';
import { badgeLayout, badgeRadius, createBadgeSprites, unitBadges, type BadgeKind } from './badges';
import { easeOutQuad } from './ease';
import { FEET, FIGURE_BOTTOM, FIGURE_TOP, PLATE, createFigureCache, drawnCharacter, paintTab, type Facing, type FigureSprites } from './figures';
import { hashString } from './noise';
import { IDENTITY_POSE, type DisplayUnit, type GfxFrame, type LightSource, type Rgb, type UnitPose, type UnitsPass } from './types';

// --- pure helpers (tested in tests/ui/ws3-units.test.ts) ---------------------------

/** Damage ghost shrink time (ms) and heal flash time (ms), spec 5.5. */
export const HP_GHOST_MS = 400;
export const HP_HEAL_MS = 300;
/** Max night shade alpha (3.5). */
export const MAX_SHADE = 0.38;

/** Per-unit HP display memory (the damage ghost and heal flash). */
export interface HpTrack {
  /** HP shown last frame (NaN = never seen). */
  shown: number;
  ghostFrom: number;
  ghostStart: number;
  healFrom: number;
  healStart: number;
}

export function newHpTrack(): HpTrack {
  return { shown: NaN, ghostFrom: 0, ghostStart: -Infinity, healFrom: 0, healStart: -Infinity };
}

/** Current top of the damage ghost (>= hp), shrinking to hp over HP_GHOST_MS with easeOutQuad. */
export function ghostTop(t: HpTrack, hp: number, now: number): number {
  const k = (now - t.ghostStart) / HP_GHOST_MS;
  if (!(k < 1) || t.ghostFrom <= hp) return hp;
  return hp + (t.ghostFrom - hp) * (1 - easeOutQuad(k));
}

/** Feeds this frame's displayed HP: a drop starts (or extends) the ghost, a gain starts the heal flash. */
export function trackHp(t: HpTrack, hp: number, now: number): void {
  if (Number.isNaN(t.shown)) {
    t.shown = hp;
    return;
  }
  if (hp < t.shown) {
    t.ghostFrom = Math.max(ghostTop(t, t.shown, now), t.shown);
    t.ghostStart = now;
  } else if (hp > t.shown) {
    t.healFrom = t.shown;
    t.healStart = now;
    t.ghostStart = -Infinity;
  }
  t.shown = hp;
}

/** Night-shade alpha for a light level (3.5): 0.38 * (1 - L), never more than 0.38. */
export function shadeAlpha(level: number): number {
  const l = level <= 0 ? 0 : level >= 1 ? 1 : level;
  return MAX_SHADE * (1 - l);
}

/** Idle bob offset in device px (5.5): 0.015T * sin(now/380 + phase). */
export function bobOffset(T: number, now: number, phase: number): number {
  return 0.015 * T * Math.sin(now / 380 + phase);
}

export type UnitLook = 'ready' | 'acted' | 'spent';

/** Acted / spent look (5.5); only for the faction whose turn it is, never for ghosts or after the game ends. */
export function unitLook(u: Pick<Unit, 'faction' | 'hasMoved' | 'hasActed'>, activeFaction: Faction, gameOver: boolean, ghost: boolean): UnitLook {
  if (ghost || gameOver || u.faction !== activeFaction) return 'ready';
  if (u.hasActed && u.hasMoved) return 'spent';
  if (u.hasActed) return 'acted';
  return 'ready';
}

/** Default facing before a unit has moved: Rebels look right, Loyalists left. */
export function defaultFacing(f: Faction): Facing {
  return f === 'rebel' ? 1 : -1;
}

/** Sort key order: display y, then x (5.5). In place, insertion sort (small lists, no allocation). */
export function sortByDisplay<T extends { y: number; x: number }>(a: T[]): T[] {
  for (let i = 1; i < a.length; i++) {
    const v = a[i] as T;
    let j = i - 1;
    for (; j >= 0; j--) {
      const w = a[j] as T;
      if (w.y < v.y || (w.y === v.y && w.x <= v.x)) break;
      a[j + 1] = w;
    }
    a[j + 1] = v;
  }
  return a;
}

/** HP bar geometry in device px relative to the tile's top-left (5.5). */
export function hpBarRect(T: number, dpr: number): { x: number; y: number; w: number; h: number } {
  const h = Math.max(Math.round(3 * dpr), Math.round(0.09 * T));
  const bottom = T - Math.max(2, Math.round(2 * dpr));
  return { x: Math.round(0.14 * T), y: bottom - h, w: Math.round(0.72 * T), h };
}

// --- pass ---------------------------------------------------------------------------

interface UnitMemo {
  facing: Facing;
  lastX: number;
  phase: number;
  hp: HpTrack;
  sprites: FigureSprites | null;
  tab: HTMLCanvasElement | null;
  /** Sort keys of this frame. */
  x: number;
  y: number;
  du: DisplayUnit | null;
  pose: Readonly<UnitPose>;
}

const ACCENT_RGB: Record<Faction, Rgb> = { rebel: [111, 211, 255], loyalist: [255, 241, 184] };
const MIRA_RGB: Rgb = [127, 224, 208];

export function createUnits(): UnitsPass {
  const figures = createFigureCache();
  const badges = createBadgeSprites();
  const memos = new Map<string, UnitMemo>();
  const order: UnitMemo[] = [];
  const kinds: BadgeKind[] = [];
  const layout: number[] = [];
  const lightPool: LightSource[] = [];
  const glowSprites: Partial<Record<Faction, HTMLCanvasElement>> = {};
  let cacheT = -1;
  let cacheDpr = -1;

  const dropSprites = (): void => {
    figures.clear();
    badges.clear();
    delete glowSprites.rebel;
    delete glowSprites.loyalist;
    for (const m of memos.values()) {
      m.sprites = null;
      m.tab = null;
    }
  };

  const ensureSize = (f: GfxFrame): void => {
    if (f.T !== cacheT || f.dpr !== cacheDpr) {
      dropSprites();
      cacheT = f.T;
      cacheDpr = f.dpr;
    }
  };

  const memoFor = (u: Unit): UnitMemo => {
    let m = memos.get(u.id);
    if (!m) {
      m = {
        facing: defaultFacing(u.faction),
        lastX: NaN,
        phase: hashString(u.id) * Math.PI * 2,
        hp: newHpTrack(),
        sprites: null,
        tab: null,
        x: 0,
        y: 0,
        du: null,
        pose: IDENTITY_POSE,
      };
      memos.set(u.id, m);
    }
    return m;
  };

  const selectionGlow = (faction: Faction, T: number): HTMLCanvasElement => {
    let c = glowSprites[faction];
    if (!c) {
      c = document.createElement('canvas');
      const size = Math.ceil(1.1 * T);
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      if (g) {
        const r = size / 2;
        const rgb = ACCENT_RGB[faction];
        const gr = g.createRadialGradient(r, r, 0, r, r, r);
        gr.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`);
        gr.addColorStop(0.55, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.22)`);
        gr.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
        g.fillStyle = gr;
        g.fillRect(0, 0, size, size);
      }
      glowSprites[faction] = c;
    }
    return c;
  };

  const lightAt = (i: number): LightSource => {
    let l = lightPool[i];
    if (!l) {
      l = { kind: 'seal', x: 0, y: 0, radius: 1, intensity: 0, color: LIGHT.seal, flicker: 0, seed: 0, lamp: false };
      lightPool[i] = l;
    }
    return l;
  };

  return {
    reset() {
      dropSprites();
      cacheT = -1;
      cacheDpr = -1;
    },
    clear() {
      memos.clear();
      order.length = 0;
    },

    collectLights(f: GfxFrame) {
      let n = 0;
      for (const du of f.units) {
        const u = du.unit;
        const pose = f.poses.get(u.id) ?? IDENTITY_POSE;
        const a = pose.alpha;
        if (a <= 0.01) continue;
        const px = du.pos.x + pose.dx;
        const py = du.pos.y + pose.dy;
        if (u.statuses.includes('sealed')) {
          const l = lightAt(n++);
          l.kind = 'seal';
          l.x = px + 0.5;
          l.y = py + 0.5;
          l.radius = 1.8;
          l.intensity = 0.6 * a;
          l.color = LIGHT.seal;
          l.flicker = 0.06;
          l.seed = hashString(u.id, 3);
          l.lamp = false;
          f.lights.push(l);
        }
        if (u.rank === 'radiant') {
          const mira = drawnCharacter(u.character) === 'mira';
          const facing = memos.get(u.id)?.facing ?? defaultFacing(u.faction);
          const l = lightAt(n++);
          l.kind = 'orb';
          l.x = px + (mira ? 0.5 : facing === 1 ? 0.3 : 0.7);
          l.y = py + (mira ? 0.55 : 0.3);
          l.radius = 1.1;
          l.intensity = 0.35 * a;
          l.color = mira ? MIRA_RGB : ACCENT_RGB[u.faction];
          l.flicker = 0.04;
          l.seed = hashString(u.id, 5);
          l.lamp = false;
          f.lights.push(l);
        }
      }
    },

    draw(f: GfxFrame) {
      ensureSize(f);
      const { ctx } = f;
      order.length = 0;
      for (const du of f.units) {
        const m = memoFor(du.unit);
        const pose = f.poses.get(du.unit.id) ?? IDENTITY_POSE;
        m.du = du;
        m.pose = pose;
        m.x = du.pos.x + pose.dx;
        m.y = du.pos.y + pose.dy;
        // Facing: pose override, else the direction of display movement.
        if (pose.facing !== undefined) m.facing = pose.facing;
        else if (!Number.isNaN(m.lastX) && Math.abs(du.pos.x - m.lastX) > 1e-4) m.facing = du.pos.x > m.lastX ? 1 : -1;
        m.lastX = du.pos.x;
        trackHp(m.hp, du.hp, f.now);
        order.push(m);
      }
      sortByDisplay(order);

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (const m of order) drawFigure(f, m);
      ctx.imageSmoothingEnabled = false;
      for (const m of order) drawOverlays(f, m);
      ctx.restore();
      for (const m of order) m.du = null;
    },
  };

  function drawFigure(f: GfxFrame, m: UnitMemo): void {
    const du = m.du;
    if (!du) return;
    const { ctx, T } = f;
    const u = du.unit;
    const pose = m.pose;
    const look = unitLook(u, f.state.activeFaction, f.state.gameOver, du.ghost);
    let alpha = pose.alpha * (look === 'spent' ? 0.6 : look === 'acted' ? 0.8 : 1);
    if (alpha <= 0.004) return;
    if (alpha > 1) alpha = 1;
    if (!m.sprites) m.sprites = figures.sprites(u, T, f.dpr);
    const sp = m.sprites;
    const x0 = m.x * T;
    const y0 = m.y * T;
    const animating = f.poses.has(u.id);
    const bob = f.motion.reduced || look === 'spent' || du.ghost || animating ? 0 : bobOffset(T, f.now, m.phase);
    const variant = look === 'spent' ? 'spent' : 'normal';
    const clip = pose.clipFromFeet ?? 0;

    if (du.selected) {
      const gs = selectionGlow(u.faction, T);
      ctx.globalAlpha = Math.min(1, pose.alpha);
      ctx.drawImage(gs, Math.round(x0 + T / 2 - gs.width / 2), Math.round(y0 + FEET * T - gs.height / 2));
    }

    ctx.save();
    const xf = pose.scale !== 1 || pose.tilt !== 0 || clip > 0;
    if (xf) {
      ctx.translate(x0 + 0.5 * T, y0 + FEET * T);
      if (pose.tilt !== 0) ctx.rotate(pose.tilt);
      if (pose.scale !== 1) ctx.scale(pose.scale, pose.scale);
      ctx.translate(-0.5 * T, -FEET * T);
      if (clip > 0) {
        const top = FIGURE_TOP * T;
        const bottom = FIGURE_BOTTOM * T;
        ctx.beginPath();
        ctx.rect(-T, -T, 3 * T, T + bottom - clip * (bottom - top));
        ctx.clip();
      }
    } else {
      ctx.translate(x0, y0);
    }

    ctx.globalAlpha = alpha;
    ctx.drawImage(sp.get('ground', variant, 1), 0, 0);
    const body = sp.get('body', variant, m.facing);
    ctx.drawImage(body, 0, bob);
    const level = f.levelAt(Math.round(du.pos.x), Math.round(du.pos.y));
    const shade = shadeAlpha(level);
    if (shade > 0.01) {
      ctx.globalAlpha = alpha * shade;
      ctx.drawImage(sp.get('body', 'shade', m.facing), 0, bob);
    }
    if (pose.flash > 0.01) {
      ctx.globalAlpha = Math.min(1, alpha * pose.flash);
      ctx.drawImage(sp.get('body', 'flash', m.facing), 0, bob);
    }
    // Seal ring around the feet, over the hem so it stays visible.
    if (u.statuses.includes('sealed')) sealRing(f, alpha);
    ctx.restore();
  }

  function sealRing(f: GfxFrame, alpha: number): void {
    const { ctx, T } = f;
    ctx.save();
    ctx.globalAlpha = alpha * 0.95;
    ctx.strokeStyle = STATUS.sealed;
    ctx.lineWidth = Math.max(1.5, T / 20);
    ctx.setLineDash([T / 10, T / 14]);
    ctx.lineDashOffset = f.motion.reduced ? 0 : -f.now / 60;
    ctx.beginPath();
    ctx.ellipse(0.5 * T, FEET * T, Math.max(0.42, PLATE.ellipseRx + 0.05) * T, Math.max(0.17, PLATE.ellipseRy + 0.05) * T, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawOverlays(f: GfxFrame, m: UnitMemo): void {
    const du = m.du;
    if (!du) return;
    const { ctx, T, dpr } = f;
    const u = du.unit;
    const pose = m.pose;
    const alpha = Math.min(1, pose.alpha * (1 - (pose.clipFromFeet ?? 0)));
    if (alpha <= 0.004) return;
    const tx = Math.round(m.x * T);
    const ty = Math.round(m.y * T);
    ctx.globalAlpha = alpha;

    if (du.selected) brackets(f, tx, ty, alpha);

    // Initial tab (named units), top-left.
    let tabRight = 0;
    if (u.character !== null) {
      if (!m.tab) m.tab = paintTab(unitGlyph(u), u.faction, T, dpr);
      const inset = Math.max(1, Math.round(dpr));
      ctx.drawImage(m.tab, tx + inset, ty + inset);
      tabRight = inset + m.tab.width;
    }

    // Status badges, top-right.
    unitBadges(u, kinds);
    if (kinds.length > 0) {
      const r = badgeRadius(T, dpr);
      badgeLayout(kinds.length, T, r, tabRight, layout);
      for (let i = 0; i < kinds.length; i++) {
        const s = badges.get(kinds[i] as BadgeKind, T, dpr);
        const bx = layout[2 * i] ?? 0;
        const by = layout[2 * i + 1] ?? 0;
        ctx.drawImage(s, Math.round(tx + bx - s.width / 2), Math.round(ty + by - s.height / 2));
      }
    }

    hpBar(f, u, du.hp, m.hp, tx, ty);
  }

  function brackets(f: GfxFrame, tx: number, ty: number, alpha: number): void {
    const { ctx, T } = f;
    const k = f.motion.reduced ? 0.9 : 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(f.now / 160));
    const w = Math.max(2, Math.round(T / 14));
    const len = Math.round(0.26 * T);
    const x1 = tx + T - w;
    const y1 = ty + T - w;
    // Dark casing first so the brackets read on bright floors.
    for (let pass = 0; pass < 2; pass++) {
      const grow = pass === 0 ? 1 : 0;
      ctx.globalAlpha = alpha * (pass === 0 ? 0.6 * k : k);
      ctx.fillStyle = pass === 0 ? 'rgba(0,0,0,1)' : '#ffffff';
      // top-left
      ctx.fillRect(tx - grow, ty - grow, len + 2 * grow, w + 2 * grow);
      ctx.fillRect(tx - grow, ty - grow, w + 2 * grow, len + 2 * grow);
      // top-right
      ctx.fillRect(tx + T - len - grow, ty - grow, len + 2 * grow, w + 2 * grow);
      ctx.fillRect(x1 - grow, ty - grow, w + 2 * grow, len + 2 * grow);
      // bottom-left
      ctx.fillRect(tx - grow, y1 - grow, len + 2 * grow, w + 2 * grow);
      ctx.fillRect(tx - grow, ty + T - len - grow, w + 2 * grow, len + 2 * grow);
      // bottom-right
      ctx.fillRect(tx + T - len - grow, y1 - grow, len + 2 * grow, w + 2 * grow);
      ctx.fillRect(x1 - grow, ty + T - len - grow, w + 2 * grow, len + 2 * grow);
    }
    ctx.globalAlpha = alpha;
  }

  function hpBar(f: GfxFrame, u: Unit, hp: number, track: HpTrack, tx: number, ty: number): void {
    const { ctx, T, dpr } = f;
    const max = u.maxHp;
    if (max <= 0) return;
    const r = hpBarRect(T, dpr);
    const x = tx + r.x;
    const y = ty + r.y;
    const ratio = Math.max(0, Math.min(1, hp / max));
    ctx.fillStyle = HP.back;
    ctx.fillRect(x - 1, y - 1, r.w + 2, r.h + 2);
    const fw = Math.round(r.w * ratio);
    ctx.fillStyle = hpColor(ratio);
    ctx.fillRect(x, y, fw, r.h);
    // Damage ghost: the lost segment, shrinking.
    const gt = ghostTop(track, hp, f.now);
    if (gt > hp) {
      const gw = Math.round(r.w * Math.min(1, gt / max)) - fw;
      if (gw > 0) {
        ctx.fillStyle = HP.ghost;
        ctx.fillRect(x + fw, y, gw, r.h);
      }
    }
    // Heal: the gained segment flashes.
    const hk = (f.now - track.healStart) / HP_HEAL_MS;
    if (hk >= 0 && hk < 1 && track.healFrom < hp) {
      const hx = Math.round(r.w * Math.max(0, track.healFrom / max));
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * (1 - hk);
      ctx.fillStyle = HP.heal;
      ctx.fillRect(x + hx, y, fw - hx, r.h);
      ctx.globalAlpha = a;
    }
    // 10-HP ticks for Ascendants.
    if (u.rank === 'ascendant' && max > 10) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const tw = Math.max(1, Math.round(dpr * 0.75));
      for (let v = 10; v < max; v += 10) ctx.fillRect(x + Math.round((r.w * v) / max), y, tw, r.h);
    }
  }
}
