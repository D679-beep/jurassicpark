// Step effects, poses, screen shake, decals, floats, banner (visual-style.md
// section 6; layers 4a, 14, 15).
// Owner: WS4 (FX, Domains, animation).
//
// Everything here is driven by the animation queue: onStepStart() schedules
// effects for a step (particles with delays so bursts land on the impact
// moment, floats, rings, flashes, lights, shake, decals, burn records);
// computePoses() derives unit poses (move hop, lunge, knockback, flash,
// death dissolve, capture/escape, arrival) from the active step and its
// progress, so poses scale with the step duration (speed setting) for free.
// Effects that outlive their step use wall-clock start/life scaled by
// settings.effectLifeScale; particles age with the frame dt (they pause
// with the frame loop when the tab is hidden).
//
// The controller still spawns banners (and may spawn legacy floats, pulses
// and tile flashes) as `Effect`s in RenderInput.effects; drawBanner() draws
// the banner card in layer 15.
import type { Faction, GameEvent, GameState, Pos, Unit } from '../../engine';
import { TIMING, type AnimStep, type DisplayOverrides } from '../animation';
import { BELL, BRIDGE, COLORS, DOMAIN, FACTION, LIGHT, MARK, STATUS } from '../palette';
import { ambientAllowed, burstLimit, effectLifeScale, shakeScale } from '../settings';
import { clamp01, easeInOutSine, easeInQuad, easeOutBack, easeOutBackWith, easeOutCubic, easeOutQuad, segment } from './ease';
import { hash, hashString, valueNoise1D } from './noise';
import {
  BoltPath,
  FX_AMBIENT_CAP,
  FX_POOL_CAP,
  GlowSprites,
  P_ADD,
  P_AMBIENT,
  P_FADE_FAST,
  P_FADE_IN,
  P_GROW,
  P_SHRINK,
  P_RECT,
  P_STREAK,
  ParticlePool,
  RAMP,
  REDUCED_CAP,
  drawLightning,
  makeCanvas,
} from './particles';
import type { DisplayUnit, FxPass, FxStepContext, GfxFrame, LightKind, LightSource, Motion, Rgb, UnitPose } from './types';

// --- controller-facing effect type ---------------------------------------------------

export type BannerTone = 'bell' | 'objective' | 'fail' | 'phase' | 'info';
/** Small emblem drawn either side of the banner title. */
export type BannerEmblem = 'bell' | 'dawn' | 'rebel' | 'loyalist' | 'check' | 'cross' | 'diamond';

/**
 * Controller-spawned effects (RenderInput.effects). Banners are the main
 * use; floats, pulses and tile flashes stay available for non-step effects.
 */
export type Effect =
  | { kind: 'float'; pos: Pos; text: string; color: string; start: number; life: number; big?: boolean }
  | { kind: 'pulse'; center: Pos; radius: number; color: string; start: number; life: number }
  | { kind: 'flash'; tiles: Pos[]; color: string; start: number; life: number }
  | {
      kind: 'banner';
      title: string;
      subtitle: string;
      color: string;
      start: number;
      life: number;
      tone?: BannerTone;
      emblem?: BannerEmblem;
    };

// --- internal effect records ------------------------------------------------------------

interface FloatFx {
  k: 'float';
  x: number;
  y: number;
  text: string;
  color: string;
  big: boolean;
  /** Word labels (Broken, Captured...): 0.75x, so numbers stay dominant. */
  small?: boolean;
  start: number;
  life: number;
}

/** Circle (or flat ellipse) ring growing/shrinking from r0 to r1 tiles. */
interface RingFx {
  k: 'ring';
  x: number;
  y: number;
  /** Follow a unit's display position (dialogue speaker pulse). */
  follow: string | null;
  r0: number;
  r1: number;
  w0: number;
  w1: number;
  color: string;
  a0: number;
  /** y radius / x radius (1 = circle). */
  squash: number;
  /** 0: grow with easeOutCubic, 1: close with easeInQuad, 2: repeating pulse (period = life of one cycle in `period`). */
  mode: 0 | 1 | 2;
  period: number;
  additive: boolean;
  start: number;
  life: number;
}

interface DiamondFx {
  k: 'diamond';
  x: number;
  y: number;
  radius: number;
  color: string;
  start: number;
  life: number;
}

/** Additive glow sprite and/or a transient light. */
interface GlowFx {
  k: 'glow';
  x: number;
  y: number;
  /** Sprite radius in tiles (0 = no sprite). */
  r: number;
  a0: number;
  /** Light radius in tiles (0 = no light). */
  lr: number;
  lk: number;
  rgb: Rgb;
  kind: LightKind;
  start: number;
  life: number;
}

interface BellFx {
  k: 'bell';
  rings: number;
  ringDelay: number;
  ringLife: number;
  swing: boolean;
  start: number;
  life: number;
}

type FxItem = FloatFx | RingFx | DiamondFx | GlowFx | BellFx;

interface Decal {
  x: number;
  y: number;
  born: number;
  fade: number;
}

interface BurnRecord {
  id: string;
  tiles: Pos[];
  /** Ignition offset per tile (ms after start), spreading from the burner's end. */
  ignite: number[];
  start: number;
  /** Ambient flame emitter accumulator (ms). */
  acc: number;
}

interface Shake {
  start: number;
  dur: number;
  ampCss: number;
  ampT: number;
  seed: number;
}

// --- constants ------------------------------------------------------------------------

const DEG = Math.PI / 180;
const MAX_DECALS = 24;
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
/** Burning phase after a bridge burns (6.3 burn, 3.2 burning bridge). */
const BURN_MS = 6000;
const FIRE: Rgb = LIGHT.fire;
const WHITE: Rgb = [255, 255, 255];
const LANTERN: Rgb = LIGHT.lantern;
const GOLD: Rgb = [232, 200, 114];
const ACCENT: Record<Faction, Rgb> = { rebel: [111, 211, 255], loyalist: [255, 241, 184] };
const easePop = easeOutBackWith(4);

const MARK_BY_CHARACTER: Record<string, string> = {
  varek: MARK.varek,
  grimm: MARK.grimm,
  kaela: MARK.kaela,
  halden: MARK.halden,
  elian: MARK.elian,
  orsa: MARK.orsaShieldRim,
  mira: MARK.miraGlow,
};

function hexRgb(c: string): Rgb {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const manhattan = (a: Pos, b: Pos): number => Math.abs(Math.round(a.x) - b.x) + Math.abs(Math.round(a.y) - b.y);

/** Unit (live or pending ghost) at step start, with its display tile. */
function lookup(state: GameState, o: DisplayOverrides, id: string | null): { unit: Unit; pos: Pos } | null {
  if (!id) return null;
  const unit = state.units.find((u) => u.id === id) ?? o.ghosts[id];
  if (!unit) return null;
  return { unit, pos: o.pos[id] ?? unit.pos };
}

function findDU(f: GfxFrame, id: string | null): DisplayUnit | null {
  if (!id) return null;
  const list = f.units;
  for (let i = 0; i < list.length; i++) if (list[i]!.unit.id === id) return list[i]!;
  return null;
}

/** Nearest map edge as an off-map direction. */
function nearestEdge(p: Pos, w: number, h: number): { dx: number; dy: number } {
  const dW = p.x;
  const dE = w - 1 - p.x;
  const dN = p.y;
  const dS = h - 1 - p.y;
  const m = Math.min(dW, dE, dN, dS);
  if (m === dW) return { dx: -1, dy: 0 };
  if (m === dE) return { dx: 1, dy: 0 };
  if (m === dS) return { dx: 0, dy: 1 };
  return { dx: 0, dy: -1 };
}

/** Big hit (6.2): 8+ damage to a unit, or a hit that kills. */
export function isBigHit(e: Extract<GameEvent, { type: 'damaged' }>): boolean {
  return e.targetKind === 'unit' && (e.amount >= 8 || e.hpAfter <= 0);
}

/** Impact moment of a hit step as step progress (6.3). */
export function impactProgress(melee: boolean, cause: string): number {
  if (cause === 'tempest' || cause === 'pyre') return 0.05;
  if (cause === 'duel') return 0.5;
  return melee ? 0.35 : 0.4;
}

/** Melee lunge offset (tiles, along the attack direction) at step progress p (6.3). */
export function lungeAt(p: number, reach: number): number {
  if (p <= 0.35) return reach * easeOutQuad(p / 0.35);
  return reach * (1 - easeInOutSine((p - 0.35) / 0.65));
}

/** Knockback offset (tiles, away from the attacker) at step progress p, impact at pI (6.3). */
export function knockbackAt(p: number, pI: number, dist: number): number {
  if (dist <= 0 || p < pI) return 0;
  const out = pI + 0.2;
  if (p <= out) return dist * easeOutQuad((p - pI) / 0.2);
  return dist * (1 - easeOutBack((p - out) / Math.max(0.001, 1 - out)));
}

/** Float number vertical rise (tiles) and scale at age fraction t / age ms (6.3 float numbers). */
export function floatMotion(ageMs: number, t: number, reduced: boolean): { rise: number; scale: number; alpha: number } {
  const rise = (reduced ? 0.3 : 0.8) * easeOutCubic(t);
  const scale = reduced ? 1 : ageMs < 180 ? 0.6 + 0.4 * easePop(ageMs / 180) : 1;
  const alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
  return { rise, scale, alpha };
}

/** Death dissolve: clip fraction and tilt sign-less amount at step progress p (6.3 death). */
export function deathPose(p: number): { flash: number; tilt: number; clip: number } {
  const flash = p < 0.2 ? 0.85 * (1 - p / 0.2) : 0;
  const tilt = 12 * DEG * easeOutQuad(p / 0.2);
  const clip = p <= 0.2 ? 0 : easeInQuad((p - 0.2) / 0.8);
  return { flash, tilt, clip };
}

// --- the pass -----------------------------------------------------------------------------

export function createFx(): FxPass {
  const pool = new ParticlePool();
  const glows = new GlowSprites();
  const bolt = new BoltPath();
  let items: FxItem[] = [];
  let decals: Decal[] = [];
  const burns = new Map<string, BurnRecord>();
  let shake: Shake | null = null;
  const shakeOut = { x: 0, y: 0 };
  let gameOverAt = -1;
  let gameOverDur: number = TIMING.gameOver;
  // Footstep dust: which tile landings of the active move step already spawned.
  let dustStep: AnimStep | null = null;
  let dustLanded = 0;
  // Reused objects (no allocation per frame).
  const posePool: UnitPose[] = [];
  let poseUsed = 0;
  const lightPool: LightSource[] = [];
  let lightUsed = 0;
  // Banner card cache.
  let bannerKey = '';
  let bannerCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  let bannerPad = 0;
  let vignette: HTMLCanvasElement | OffscreenCanvas | null = null;
  let vignetteKey = '';

  const add = (it: FxItem): void => {
    items.push(it);
  };

  function pose(f: GfxFrame, id: string): UnitPose {
    const existing = f.poses.get(id);
    if (existing) return existing;
    let p = posePool[poseUsed];
    if (!p) {
      p = { dx: 0, dy: 0, flash: 0, alpha: 1, scale: 1, tilt: 0 };
      posePool.push(p);
    }
    poseUsed++;
    p.dx = 0;
    p.dy = 0;
    p.flash = 0;
    p.alpha = 1;
    p.scale = 1;
    p.tilt = 0;
    p.clipFromFeet = undefined;
    p.facing = undefined;
    f.poses.set(id, p);
    return p;
  }

  function light(f: GfxFrame, kind: LightKind, x: number, y: number, radius: number, intensity: number, color: Rgb, flicker = 0, seed = 0): void {
    if (intensity <= 0.01 || radius <= 0) return;
    let l = lightPool[lightUsed];
    if (!l) {
      l = { kind, x, y, radius, intensity, color, flicker, seed, lamp: false };
      lightPool.push(l);
    }
    lightUsed++;
    l.kind = kind;
    l.x = x;
    l.y = y;
    l.radius = radius;
    l.intensity = intensity;
    l.color = color;
    l.flicker = flicker;
    l.seed = seed;
    l.lamp = false;
    l.darken = undefined;
    f.lights.push(l);
  }

  function setLimits(m: Motion): void {
    pool.limits.cap = m.reduced ? REDUCED_CAP : FX_POOL_CAP;
    pool.limits.ambientCap = ambientAllowed(m) ? FX_AMBIENT_CAP : 0;
  }

  function startShake(now: number, ampCss: number, ampT: number, dur: number, m: Motion): void {
    if (shakeScale(m) <= 0) return;
    shake = { start: now, dur, ampCss, ampT, seed: Math.floor(hash(Math.floor(now), 3, 11) * 1000) };
  }

  // --- bursts -----------------------------------------------------------------------

  /** Radial sparks (streaks) at (x, y) tiles. */
  function sparks(n: number, x: number, y: number, ramp: number, life: number, delay: number, dirX = 0, dirY = 0, seed = 0): void {
    for (let i = 0; i < n; i++) {
      const h1 = hash(i, seed, 1);
      const h2 = hash(i, seed, 2);
      let ang = h1 * Math.PI * 2;
      if (dirX !== 0 || dirY !== 0) ang = Math.atan2(dirY, dirX) + (h1 - 0.5) * 2.2;
      const sp = 1.5 + 1.5 * h2;
      pool.spawn(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, life, 0.035, ramp, P_ADD | P_STREAK, delay, 1.5, 2.5);
    }
  }

  function debrisRects(n: number, x: number, y: number, ramps: readonly number[], life0: number, life1: number, speed0: number, speed1: number, gravity: number, axis: 'ns' | 'ew' | null, delay: number, seed: number, additive: boolean, size = 1): void {
    for (let i = 0; i < n; i++) {
      const h1 = hash(i, seed, 3);
      const h2 = hash(i, seed, 4);
      const h3 = hash(i, seed, 5);
      let ang = h1 * Math.PI * 2;
      if (axis === 'ns') ang = (h1 < 0.5 ? -Math.PI / 2 : Math.PI / 2) + (h2 - 0.5) * 1.3;
      else if (axis === 'ew') ang = (h1 < 0.5 ? Math.PI : 0) + (h2 - 0.5) * 1.3;
      const sp = speed0 + (speed1 - speed0) * h3;
      const vy = Math.sin(ang) * sp - (gravity > 0 ? 0.8 : 0);
      pool.spawn(
        x,
        y,
        Math.cos(ang) * sp,
        vy,
        life0 + (life1 - life0) * h2,
        (0.02 + 0.02 * h3) * size,
        ramps[i % ramps.length]!,
        P_RECT | (additive ? P_ADD : 0),
        delay,
        gravity,
        1.2,
        1,
        h1 * 6.28,
        (h2 - 0.5) * 18,
      );
    }
  }

  /** Puffs (dust, smoke, domain colour) drifting outward from (x, y). */
  function puffs(n: number, x: number, y: number, ramp: number, life: number, speed: number, size: number, alpha: number, delay: number, seed: number, flags = 0, rise = 0): void {
    for (let i = 0; i < n; i++) {
      const h1 = hash(i, seed, 6);
      const h2 = hash(i, seed, 7);
      const ang = h1 * Math.PI * 2;
      const sp = speed * (0.5 + 0.5 * h2);
      pool.spawn(x + Math.cos(ang) * 0.12, y + Math.sin(ang) * 0.06, Math.cos(ang) * sp, Math.sin(ang) * sp * 0.5 - rise, life * (0.8 + 0.4 * h2), size * (0.7 + 0.6 * h1), ramp, flags | P_FADE_FAST | P_GROW, delay, 0, 1.5, alpha);
    }
  }

  // --- step start: schedule effects -----------------------------------------------------

  function onStart(step: AnimStep, c: FxStepContext): void {
    const e = step.event;
    const now = c.now;
    const m = c.motion;
    const dur = step.duration;
    const pLife = effectLifeScale('particle', m.speed);
    const floatLife = effectLifeScale('float', m.speed);
    const ringLife = effectLifeScale('ring', m.speed);
    const flashLife = effectLifeScale('flash', m.speed);
    const pulseLife = effectLifeScale('pulse', m.speed);
    const seed = Math.floor(now) & 0xffff;
    const st = c.state;
    setLimits(m);

    switch (e.type) {
      case 'damaged': {
        const src = lookup(st, c.overrides, e.sourceId);
        const tx = e.pos.x + 0.5;
        const ty = e.pos.y + 0.5;
        const melee = !src || manhattan(src.pos, e.pos) <= 1;
        const pI = impactProgress(melee, e.cause);
        const tImpact = now + pI * dur;
        const delay = pI * dur;
        const big = isBigHit(e);
        if (e.cause === 'attack') {
          let dx = 0;
          let dy = 0;
          if (src) {
            dx = tx - (src.pos.x + 0.5);
            dy = ty - (src.pos.y + 0.5);
            const d = Math.hypot(dx, dy) || 1;
            dx /= d;
            dy /= d;
          }
          const ramp = src?.unit.faction === 'loyalist' ? RAMP.sparkLoyal : RAMP.sparkRebel;
          sparks(burstLimit(6, m, 'impact'), tx - dx * 0.2, ty - dy * 0.2 - 0.05, ramp, 300 * pLife, delay, dx, dy, seed);
          if (e.targetKind === 'object') {
            const obj = st.map.objects.find((o) => o.id === e.targetId);
            const n = burstLimit(4, m, 'debris');
            if (obj?.kind === 'anchor') debrisRects(n, tx, ty - 0.05, [RAMP.shard], 400 * pLife, 520 * pLife, 1.5, 3, 0, null, delay, seed, true, 1.4);
            else debrisRects(n, tx, ty, [RAMP.woodLight, RAMP.wood], 450 * pLife, 650 * pLife, 1.2, 2.4, 3, null, delay, seed, false, 1.3);
          }
          const rgb = src ? ACCENT[src.unit.faction] : WHITE;
          add({ k: 'glow', x: tx - dx * 0.25, y: ty - dy * 0.25, r: big ? 0.45 : 0.32, a0: 0.4, lr: 1.5, lk: big ? 0.7 : 0.5, rgb, kind: 'flash', start: tImpact, life: 200 * flashLife });
        } else if (e.cause === 'tempest') {
          sparks(burstLimit(4, m, 'impact'), tx, e.pos.y + 0.82, RAMP.tempest, 260 * pLife, delay, 0, -1, seed);
          add({ k: 'glow', x: tx, y: e.pos.y + 0.7, r: 0.8, a0: 0.7, lr: 1.5, lk: 0.8, rgb: [143, 216, 255], kind: 'flash', start: now, life: Math.max(120, 0.45 * dur) });
        } else if (e.cause === 'pyre') {
          const n = burstLimit(8, m);
          for (let i = 0; i < n; i++) {
            const h1 = hash(i, seed, 8);
            const h2 = hash(i, seed, 9);
            pool.spawn(e.pos.x + 0.2 + 0.6 * h1, e.pos.y + 0.85, (h1 - 0.5) * 0.6, -(1.4 + 1.2 * h2), 400 * pLife, 0.07 + 0.04 * h2, RAMP.flame, P_ADD | P_SHRINK, delay * h2, -0.6, 0.6);
          }
          add({ k: 'glow', x: tx, y: e.pos.y + 0.7, r: 0.7, a0: 0.5, lr: 1.2, lk: 0.7, rgb: FIRE, kind: 'fire', start: now, life: 380 * flashLife });
        } else if (e.cause === 'duel') {
          const a = lookup(st, c.overrides, e.targetId);
          const b = src;
          const mx = a && b ? (a.pos.x + b.pos.x) / 2 + 0.5 : tx;
          const my = a && b ? (a.pos.y + b.pos.y) / 2 + 0.45 : ty;
          sparks(burstLimit(5, m, 'impact'), mx, my, RAMP.clash, 300 * pLife, delay, 0, 0, seed);
          add({ k: 'glow', x: mx, y: my, r: 0.45, a0: 0.6, lr: 1.2, lk: 0.5, rgb: [255, 208, 138], kind: 'flash', start: tImpact, life: 200 * flashLife });
        }
        add({
          k: 'float',
          x: e.pos.x,
          y: e.pos.y,
          text: `-${e.amount}`,
          color: e.targetKind === 'object' ? '#ffc07a' : '#ff8a7a',
          big,
          start: tImpact,
          life: 950 * floatLife,
        });
        if (big) startShake(tImpact, 3, 0.06, 220, m);
        break;
      }
      case 'healed': {
        const x = e.pos.x + 0.5;
        const y = e.pos.y + 0.7;
        const n = burstLimit(6, m);
        for (let i = 0; i < n; i++) {
          const h1 = hash(i, seed, 10);
          const h2 = hash(i, seed, 11);
          pool.spawn(x + (h1 - 0.5) * 0.6, y - h2 * 0.2, (h1 - 0.5) * 0.15, -1.1, 600 * pLife, 0.035, RAMP.heal, P_ADD | P_FADE_IN, i * 25, 0, 0.9);
        }
        add({ k: 'ring', x, y: e.pos.y + 0.55, follow: null, r0: 0.2, r1: 0.45, w0: 0.06, w1: 0.02, color: '#cfe9a0', a0: 0.6, squash: 1, mode: 0, period: 0, additive: true, start: now, life: 500 * ringLife });
        add({ k: 'float', x: e.pos.x, y: e.pos.y, text: `+${e.amount}`, color: '#9ff0a6', big: false, start: now, life: 950 * floatLife });
        break;
      }
      case 'died': {
        const x = e.pos.x + 0.5;
        const feet = e.pos.y + 0.82;
        if (m.reduced) {
          const n = burstLimit(4, m);
          for (let i = 0; i < n; i++) {
            const h = hash(i, seed, 12);
            pool.spawn(x + (h - 0.5) * 0.4, feet - 0.2 - 0.4 * h, (h - 0.5) * 0.2, -0.6, 600 * pLife, 0.03, RAMP.ember, P_ADD, i * 60 * (dur / TIMING.death));
          }
        } else {
          const n = burstLimit(14, m);
          for (let i = 0; i < n; i++) {
            const h1 = hash(i, seed, 13);
            const h2 = hash(i, seed, 14);
            const k = (i + 0.5) / n; // height fraction on the figure
            const d = dur * (0.2 + 0.8 * Math.sqrt(k)); // when the dissolve line reaches it
            pool.spawn(x + (h1 - 0.5) * 0.46, feet - k * 0.7, (h1 - 0.5) * 0.35, -(0.6 + 0.5 * h2), (600 + 300 * h2) * pLife, 0.022 + 0.018 * h2, RAMP.ember, P_ADD, d * 0.9, -0.25, 0.4);
          }
          const na = burstLimit(6, m);
          for (let i = 0; i < na; i++) {
            const h1 = hash(i, seed, 15);
            const h2 = hash(i, seed, 16);
            pool.spawn(x + (h1 - 0.5) * 0.5, feet - 0.3 - 0.35 * h2, (h1 - 0.5) * 0.3, 0.18 + 0.12 * h2, 900 * pLife, 0.025, RAMP.ash, P_RECT, dur * (0.3 + 0.5 * h2), 0.15, 0.3, 0.9, h1 * 6, (h2 - 0.5) * 6);
          }
        }
        decals.push({ x: e.pos.x, y: e.pos.y, born: now, fade: Math.max(200, dur) });
        if (decals.length > MAX_DECALS) decals = decals.slice(decals.length - MAX_DECALS);
        if (e.cause === 'confront') startShake(now, 3, 0.06, 220, m);
        break;
      }
      case 'captured': {
        add({ k: 'ring', x: e.pos.x + 0.5, y: e.pos.y + 0.62, follow: null, r0: 0.6, r1: 0.25, w0: 0.05, w1: 0.09, color: STATUS.escapee, a0: 0.9, squash: 0.55, mode: 1, period: 0, additive: false, start: now, life: Math.max(150, dur) });
        add({ k: 'ring', x: e.pos.x + 0.5, y: e.pos.y + 0.62, follow: null, r0: 0.66, r1: 0.3, w0: 0.025, w1: 0.04, color: '#e8c872', a0: 0.9, squash: 0.55, mode: 1, period: 0, additive: false, start: now, life: Math.max(150, dur) });
        add({ k: 'float', x: e.pos.x, y: e.pos.y, text: 'Captured', color: '#9fe0a8', big: false, small: true, start: now, life: 1200 * floatLife });
        break;
      }
      case 'escaped': {
        const exit = st.map.exits.find((x) => x.id === e.exitId);
        const tiles = exit?.tiles.length ? exit.tiles : [e.pos];
        const n = burstLimit(8, m);
        for (let i = 0; i < n; i++) {
          const t = tiles[i % tiles.length]!;
          const ang = (i / n) * Math.PI * 2;
          // Tangential velocity: a swirl.
          pool.spawn(t.x + 0.5 + Math.cos(ang) * 0.32, t.y + 0.55 + Math.sin(ang) * 0.2, -Math.sin(ang) * 1.2, Math.cos(ang) * 0.7 - 0.2, 650 * pLife, 0.035, RAMP.teal, P_ADD, i * 30, 0, 1.2);
        }
        add({ k: 'float', x: e.pos.x, y: e.pos.y, text: 'Escaped', color: '#f39a8a', big: false, small: true, start: now, life: 1200 * floatLife });
        break;
      }
      case 'objectDestroyed': {
        const x = e.pos.x + 0.5;
        const y = e.pos.y + 0.5;
        if (e.objectKind === 'door') {
          const row = st.map.terrain[e.pos.y];
          const wall = (xx: number): boolean => row?.[xx] === 'wall';
          const axis: 'ns' | 'ew' = wall(e.pos.x - 1) && wall(e.pos.x + 1) ? 'ns' : 'ew';
          debrisRects(burstLimit(12, m, 'debris'), x, y, [RAMP.wood, RAMP.woodLight, RAMP.woodDark], 500 * pLife, 700 * pLife, 1.5, 3.2, 3, axis, 0, seed, false, 1.5);
          puffs(burstLimit(5, m), x, y + 0.2, RAMP.smoke, 650 * pLife, 0.5, 0.12, 0.5, 0, seed, 0, 0.2);
          add({ k: 'glow', x, y, r: 0.6, a0: 0.35, lr: 1.5, lk: 0.5, rgb: [255, 170, 80], kind: 'flash', start: now, life: 300 * flashLife });
          add({ k: 'float', x: e.pos.x, y: e.pos.y + 0.35, text: 'Broken', color: '#ffd08a', big: false, small: true, start: now + 120 * floatLife, life: 1000 * floatLife });
        } else {
          debrisRects(burstLimit(16, m, 'debris'), x, y - 0.05, [RAMP.shard], 500 * pLife, 500 * pLife, 2, 4, 0, null, 0, seed, true, 1.7);
          add({ k: 'glow', x, y: y - 0.05, r: 1.3, a0: 0.9, lr: 2.5, lk: 0.9, rgb: [200, 244, 255], kind: 'flash', start: now, life: 500 * flashLife });
          add({ k: 'ring', x, y: e.pos.y + 0.78, follow: null, r0: 0.34, r1: 0.6, w0: 0.05, w1: 0.01, color: '#78aaff', a0: 0.9, squash: 0.38, mode: 0, period: 0, additive: true, start: now, life: Math.max(150, 320 * (dur / TIMING.objectBreak || 1)) });
          add({ k: 'float', x: e.pos.x, y: e.pos.y + 0.35, text: 'Shattered', color: '#bfe6ff', big: false, small: true, start: now + 120 * floatLife, life: 1000 * floatLife });
        }
        startShake(now, 2, 0.04, 180, m);
        break;
      }
      case 'domainActivated': {
        const look = DOMAIN[e.domain];
        add({ k: 'diamond', x: e.center.x, y: e.center.y, radius: e.radius, color: look.edge, start: now, life: 900 * pulseLife });
        add({ k: 'diamond', x: e.center.x, y: e.center.y, radius: e.radius, color: look.label, start: now + 200 * pulseLife, life: 900 * pulseLife });
        if (e.domain === 'tempest' || e.domain === 'pyre') startShake(now, 5, 0.1, 300, m);
        break;
      }
      case 'domainEnded': {
        const o = lookup(st, c.overrides, e.unitId);
        if (o) {
          const ramp = RAMP[e.domain];
          puffs(burstLimit(6, m), o.pos.x + 0.5, o.pos.y + 0.55, ramp, 600 * pLife, 1.6, 0.04, 0.9, 0, seed, P_ADD);
          if (e.drained) {
            add({ k: 'ring', x: o.pos.x + 0.5, y: o.pos.y + 0.55, follow: null, r0: 0.25, r1: 0.6, w0: 0.08, w1: 0.02, color: STATUS.drained, a0: 0.85, squash: 1, mode: 0, period: 0, additive: false, start: now + dur * 0.8, life: 450 * ringLife });
          }
        }
        break;
      }
      case 'bellRang': {
        const rings = m.reduced ? 1 : 3;
        add({ k: 'bell', rings, ringDelay: 300 * ringLife, ringLife: 1200 * ringLife, swing: !m.reduced, start: now, life: 300 * ringLife * (rings - 1) + 1200 * ringLife });
        break;
      }
      case 'reinforcementsArrived': {
        const k = dur / TIMING.arrive;
        e.units.forEach((u, i) => {
          const n = burstLimit(3, m);
          puffs(n, u.pos.x + 0.5, u.pos.y + 0.82, RAMP.dust, 500 * pLife, 0.6, 0.06, 0.55, i * 60 * k, seed + i, 0, 0.1);
        });
        const gate = st.map.objects.find((o) => o.kind === 'gate' && o.wave === e.waveId);
        let gx: number;
        let gy: number;
        if (gate && gate.kind === 'gate' && gate.tiles.length > 0) {
          gx = gate.tiles.reduce((s, t) => s + t.x, 0) / gate.tiles.length + 0.5;
          gy = gate.tiles.reduce((s, t) => s + t.y, 0) / gate.tiles.length + 0.5;
        } else if (e.units.length > 0) {
          // The map-edge opening nearest the first unit.
          const p = e.units[0]!.pos;
          const d = nearestEdge(p, st.map.width, st.map.height);
          gx = (d.dx < 0 ? 0 : d.dx > 0 ? st.map.width - 1 : p.x) + 0.5;
          gy = (d.dy < 0 ? 0 : d.dy > 0 ? st.map.height - 1 : p.y) + 0.5;
        } else break;
        add({ k: 'glow', x: gx, y: gy, r: 1.2, a0: 0.55, lr: 2.0, lk: 0.8, rgb: LANTERN, kind: 'flash', start: now, life: Math.max(200, dur) });
        break;
      }
      case 'bridgeBurned': {
        const tiles = e.tiles.map((t) => ({ x: t.x, y: t.y }));
        // Spread from the end nearest the burner (6.3 burn: multi-tile bridges catch one tile after another).
        const by = lookup(st, c.overrides, e.byUnitId);
        const ref = by?.pos ?? tiles[0] ?? { x: 0, y: 0 };
        const order = tiles.map((t) => Math.abs(t.x - ref.x) + Math.abs(t.y - ref.y));
        const minD = Math.min(...order);
        const ignite = order.map((d) => Math.min(0.6, (d - minD) * 0.2) * Math.max(1, dur));
        burns.set(e.bridgeId, { id: e.bridgeId, tiles, ignite, start: now, acc: 0 });
        const n = burstLimit(10, m);
        tiles.forEach((t, ti) => {
          const ig = ignite[ti] ?? 0;
          for (let i = 0; i < n; i++) {
            const h1 = hash(i, ti + seed, 17);
            const h2 = hash(i, ti + seed, 18);
            pool.spawn(t.x + 0.12 + 0.76 * h1, t.y + 0.35 + 0.45 * h2, (h1 - 0.5) * 0.3, -(0.9 + 0.9 * h2), (420 + 200 * h2) * pLife, 0.08 + 0.05 * h1, RAMP.flame, P_ADD | P_SHRINK, ig + (dur - ig) * 0.8 * (i / n), -0.4, 0.5);
          }
          add({ k: 'glow', x: t.x + 0.5, y: t.y + 0.5, r: 0.9, a0: 0.55, lr: 0, lk: 0, rgb: FIRE, kind: 'fire', start: now + ig, life: 500 * flashLife });
        });
        break;
      }
      case 'sealBroken': {
        for (const id of e.unitIds) {
          const o = lookup(st, c.overrides, id);
          if (!o) continue;
          const x = o.pos.x + 0.5;
          const y = o.pos.y + 0.75;
          debrisRects(burstLimit(8, m), x, y, [RAMP.seal], 550 * pLife, 700 * pLife, 1.6, 2.4, 0, null, 0, seed, true);
          add({ k: 'ring', x, y: o.pos.y + 0.6, follow: null, r0: 0.45, r1: 2, w0: 0.1, w1: 0.02, color: STATUS.sealed, a0: 0.8, squash: 1, mode: 0, period: 0, additive: true, start: now, life: 800 * ringLife });
          add({ k: 'glow', x, y: o.pos.y + 0.5, r: 0.9, a0: 0.5, lr: 1.8, lk: 0.6, rgb: LIGHT.seal, kind: 'flash', start: now, life: 500 * flashLife });
        }
        break;
      }
      case 'duelEnded': {
        const a = lookup(st, c.overrides, e.unitIds[0]);
        const b = lookup(st, c.overrides, e.unitIds[1]);
        if (a && b) sparks(burstLimit(5, m), (a.pos.x + b.pos.x) / 2 + 0.5, (a.pos.y + b.pos.y) / 2 + 0.45, RAMP.clash, 300 * pLife, 0, 0, 0, seed);
        break;
      }
      case 'gameOver':
        gameOverAt = now;
        gameOverDur = Math.max(1, dur);
        break;
      case 'dialogue': {
        const sid = e.speakerId;
        const u = sid ? st.units.find((x) => x.id === sid || x.character === sid) : undefined;
        if (u) add({ k: 'ring', x: 0, y: 0, follow: u.id, r0: 0.3, r1: 0.62, w0: 0.06, w1: 0.015, color: '#ffffff', a0: 0.55, squash: 0.5, mode: 2, period: 1200, additive: false, start: now, life: Math.max(600, dur) });
        break;
      }
      default:
        break;
    }
  }

  // --- poses ----------------------------------------------------------------------------

  function computePoses(f: GfxFrame): void {
    poseUsed = 0;
    setLimits(f.motion);
    const a = f.input.active;
    if (!a) {
      dustStep = null;
      return;
    }
    const { step, progress: p } = a;
    const e = step.event;
    const reduced = f.motion.reduced;
    switch (e.type) {
      case 'moved': {
        const n = Math.max(1, e.path.length);
        const fp = p * n;
        const i = Math.min(n - 1, Math.floor(fp));
        const local = p >= 1 ? 1 : fp - i;
        const from = i === 0 ? e.from : e.path[i - 1]!;
        const to = e.path[i] ?? e.to;
        const ps = pose(f, e.unitId);
        const sdx = to.x - from.x;
        if (sdx !== 0) ps.facing = sdx > 0 ? 1 : -1;
        // Ease the whole walk in and out (half linear, half sine) on top of the renderer's linear lerp.
        const pe = p + 0.5 * (easeInOutSine(p) - p);
        const fe = pe * n;
        const ie = Math.min(n - 1, Math.floor(fe));
        const le = pe >= 1 ? 1 : fe - ie;
        const ea = ie === 0 ? e.from : e.path[ie - 1]!;
        const eb = e.path[ie] ?? e.to;
        ps.dx = ea.x + (eb.x - ea.x) * le - (from.x + sdx * local);
        ps.dy = ea.y + (eb.y - ea.y) * le - (from.y + (to.y - from.y) * local);
        if (!reduced) ps.dy -= 0.06 * Math.sin(Math.PI * (fe - ie));
        // Footstep dust: 2 puffs per landing (ambient).
        if (dustStep !== step) {
          dustStep = step;
          dustLanded = 0;
        }
        const landed = Math.min(n, Math.floor(fe + 1e-6));
        if (landed > dustLanded) {
          for (let k = dustLanded; k < landed; k++) {
            const t = e.path[k] ?? e.to;
            const prev = k === 0 ? e.from : e.path[k - 1]!;
            const bx = -(t.x - prev.x);
            const by = -(t.y - prev.y);
            for (let j = 0; j < 2; j++) {
              const h = hash(t.x * 7 + j, t.y, k);
              pool.spawn(t.x + 0.5 + (j === 0 ? -0.12 : 0.12), t.y + 0.84, bx * 0.29 + (h - 0.5) * 0.12, by * 0.29 - 0.08, 350 * effectLifeScale('particle', f.motion.speed), 0.04, RAMP.dust, P_AMBIENT | P_FADE_FAST | P_GROW, 0, 0, 0, 0.6);
            }
          }
          dustLanded = landed;
        }
        break;
      }
      case 'damaged': {
        const src = findDU(f, e.sourceId);
        const tgt = e.targetKind === 'unit' ? findDU(f, e.targetId) : null;
        const tp = tgt ? tgt.pos : e.pos;
        const melee = !src || manhattan(src.pos, e.pos) <= 1;
        const pI = impactProgress(melee, e.cause);
        // Impact flash 0.85 -> 0 over 120 ms of a 280 ms hit, scaled with the step.
        const flashSpan = 120 / TIMING.hit;
        const flash = p >= pI && p < pI + flashSpan ? 0.85 * (1 - (p - pI) / flashSpan) : 0;
        if (e.cause === 'attack' && src) {
          let dx = tp.x - src.pos.x;
          let dy = tp.y - src.pos.y;
          const d = Math.hypot(dx, dy) || 1;
          dx /= d;
          dy /= d;
          const sp = pose(f, src.unit.id);
          if (Math.abs(dx) > 0.01) sp.facing = dx > 0 ? 1 : -1;
          if (melee) {
            const l = lungeAt(p, reduced ? 0.1 : 0.28);
            sp.dx = dx * l;
            sp.dy = dy * l;
          } else {
            const r = 0.06 * (p < 0.1 ? easeOutQuad(p / 0.1) : 1 - easeInOutSine(segment(p, 0.1, 0.3)));
            sp.dx = -dx * r;
            sp.dy = -dy * r;
          }
          if (tgt) {
            const tpz = pose(f, tgt.unit.id);
            tpz.flash = flash;
            const kb = knockbackAt(p, pI, reduced ? 0 : 0.12);
            tpz.dx = dx * kb;
            tpz.dy = dy * kb;
          }
        } else if (e.cause === 'duel' && src && tgt) {
          let dx = tgt.pos.x - src.pos.x;
          let dy = tgt.pos.y - src.pos.y;
          const d = Math.hypot(dx, dy) || 1;
          dx /= d;
          dy /= d;
          const nudge = (reduced ? 0.04 : 0.08) * (p < 0.5 ? easeOutQuad(p / 0.5) : easeOutQuad((1 - p) / 0.5));
          const sp = pose(f, src.unit.id);
          sp.dx = dx * nudge;
          sp.dy = dy * nudge;
          if (Math.abs(dx) > 0.01) sp.facing = dx > 0 ? 1 : -1;
          const tpz = pose(f, tgt.unit.id);
          tpz.dx = -dx * nudge;
          tpz.dy = -dy * nudge;
          tpz.flash = flash;
          if (Math.abs(dx) > 0.01) tpz.facing = dx > 0 ? -1 : 1;
        } else if (tgt) {
          // Tempest / pyre / sourceless damage: flash only, no knockback.
          pose(f, tgt.unit.id).flash = e.cause === 'pyre' ? flash * 0.7 : flash;
        }
        break;
      }
      case 'died': {
        const ps = pose(f, e.unitId);
        if (reduced) {
          // 300 ms fade inside the 480 ms step.
          ps.alpha = 1 - clamp01(p / (300 / TIMING.death));
          break;
        }
        const killer = findDU(f, e.killerId);
        const du = findDU(f, e.unitId);
        const vx = du ? du.pos.x : e.pos.x;
        const side = killer ? (killer.pos.x < vx ? 1 : killer.pos.x > vx ? -1 : hash(e.pos.x, e.pos.y, 2) < 0.5 ? 1 : -1) : hash(e.pos.x, e.pos.y, 2) < 0.5 ? 1 : -1;
        const dp = deathPose(p);
        ps.flash = dp.flash;
        ps.tilt = side * dp.tilt;
        ps.clipFromFeet = dp.clip;
        if (killer && Math.abs(killer.pos.x - vx) > 0.01) ps.facing = killer.pos.x > vx ? 1 : -1;
        break;
      }
      case 'captured': {
        const ps = pose(f, e.unitId);
        ps.scale = 1 - 0.2 * easeInQuad(p);
        ps.alpha = 1 - easeInQuad(p);
        break;
      }
      case 'escaped': {
        const ps = pose(f, e.unitId);
        const exit = f.sites.exits.find((x) => x.id === e.exitId);
        const dir = exit?.dir ?? nearestEdge(e.pos, f.mapW, f.mapH);
        const s = reduced ? 0 : 0.6 * easeInQuad(p);
        ps.dx = dir.dx * s;
        ps.dy = dir.dy * s;
        ps.alpha = 1 - p;
        if (dir.dx !== 0) ps.facing = dir.dx > 0 ? 1 : -1;
        break;
      }
      case 'reinforcementsArrived': {
        const n = e.units.length;
        const k = step.duration / TIMING.arrive;
        const stagger = 60 * k;
        const span = Math.max(1, step.duration - stagger * Math.max(0, n - 1));
        const elapsed = p * step.duration;
        for (let i = 0; i < n; i++) {
          const u = e.units[i]!;
          const lp = clamp01((elapsed - i * stagger) / span);
          const ps = pose(f, u.unitId);
          const d = nearestEdge(u.pos, f.mapW, f.mapH);
          const off = reduced ? 0 : 0.8 * (1 - easeOutCubic(lp));
          ps.dx = d.dx * off;
          ps.dy = d.dy * off;
          ps.alpha = easeOutCubic(clamp01(lp / 0.6));
          if (d.dx !== 0) ps.facing = d.dx < 0 ? 1 : -1;
        }
        break;
      }
      case 'domainActivated': {
        const ps = pose(f, e.unitId);
        ps.flash = p < 0.15 ? 0.6 * (1 - p / 0.15) : 0;
        break;
      }
      default:
        break;
    }
  }

  // --- per-frame drawing helpers ------------------------------------------------------------

  function drawFloat(f: GfxFrame, x: number, y: number, text: string, color: string, big: boolean, ageMs: number, t: number, small = false): void {
    const { ctx, T } = f;
    const mo = floatMotion(ageMs, t, f.motion.reduced);
    const size = Math.max(f.px(13), Math.round(T * 0.52)) * (big ? 1.25 : small ? 0.75 : 1);
    const cx = (x + 0.5) * T;
    const cy = (y + 0.3 - mo.rise) * T;
    ctx.save();
    ctx.translate(cx, cy);
    if (mo.scale !== 1) ctx.scale(mo.scale, mo.scale);
    ctx.globalAlpha = clamp01(mo.alpha);
    ctx.font = `800 ${Math.round(size)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (big) {
      ctx.strokeStyle = 'rgba(255,210,122,0.55)';
      ctx.lineWidth = Math.max(f.px(6), size * 0.34);
      ctx.strokeText(text, 0, 0);
    }
    ctx.strokeStyle = 'rgba(6,5,10,0.92)';
    ctx.lineWidth = Math.max(f.px(4), size * 0.2);
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function drawRing(f: GfxFrame, it: RingFx, t: number): void {
    const { ctx, T } = f;
    let x = it.x;
    let y = it.y;
    if (it.follow) {
      const du = findDU(f, it.follow);
      if (!du) return;
      const ps = f.poses.get(it.follow);
      x = du.pos.x + (ps?.dx ?? 0) + 0.5;
      y = du.pos.y + (ps?.dy ?? 0) + 0.82;
    }
    let k: number;
    let a: number;
    if (it.mode === 2) {
      const ph = ((f.now - it.start) % it.period) / it.period;
      k = f.motion.reduced ? 0.5 : easeOutCubic(ph);
      a = it.a0 * (f.motion.reduced ? 0.6 : Math.sin(Math.PI * ph)) * Math.min(1, (1 - t) * 6);
    } else if (it.mode === 1) {
      k = easeInQuad(t);
      a = it.a0 * (t < 0.8 ? 1 : (1 - t) / 0.2);
    } else {
      k = easeOutCubic(t);
      a = it.a0 * (1 - t);
    }
    if (a <= 0.01) return;
    const r = (it.r0 + (it.r1 - it.r0) * k) * T;
    ctx.globalAlpha = clamp01(a);
    ctx.strokeStyle = it.color;
    ctx.lineWidth = Math.max(1, (it.w0 + (it.w1 - it.w0) * k) * T);
    if (it.additive) ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.ellipse(x * T, y * T, r, r * it.squash, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function bellRopeDir(f: GfxFrame, bx: number, by: number): { dx: number; dy: number } {
    const pass = f.sites.passable;
    const cand: readonly [number, number][] = [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ];
    for (const [dx, dy] of cand) if (pass[by + dy]?.[bx + dx]) return { dx, dy };
    return { dx: 0, dy: 1 };
  }

  function drawBell(f: GfxFrame, it: BellFx): void {
    const { ctx, T } = f;
    const age = f.now - it.start;
    const bells = f.sites.bells;
    const count = bells.length > 0 ? bells.length : 1;
    for (let b = 0; b < count; b++) {
      let cx: number;
      let cy: number;
      const site = bells[b];
      if (site) {
        cx = site.x + 0.5;
        cy = site.y + 0.5;
      } else {
        const box = f.sites.zoneBoxes['bellTower'];
        if (!box) return;
        cx = box.x + box.w / 2;
        cy = box.y + box.h / 2;
      }
      // Rope swing (+-18 deg, period 500 ms, decay 600 ms) and the bronze rim shimmer.
      if (site) {
        const shimmer = clamp01(1 - age / 1400);
        if (shimmer > 0) {
          ctx.globalCompositeOperation = 'lighter';
          glows.draw(ctx, [224, 189, 114], cx * T, cy * T, 0.9 * T, 0.35 * shimmer);
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = BELL.hi;
          ctx.globalAlpha = shimmer * (it.swing ? 0.55 + 0.45 * Math.sin(age / 55) : 0.8);
          ctx.lineWidth = Math.max(1.5, T / 18);
          ctx.beginPath();
          ctx.arc(cx * T, cy * T, 0.4 * T, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (it.swing && age < 1500) {
          const d = bellRopeDir(f, site.x, site.y);
          const ang = 18 * DEG * Math.sin((2 * Math.PI * age) / 500) * Math.exp(-age / 600);
          const px0 = (cx + d.dx * 0.18) * T;
          const py0 = (cy + d.dy * 0.18) * T;
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          const rx = d.dx * c - d.dy * s;
          const ry = d.dx * s + d.dy * c;
          const len = 0.7 * T;
          ctx.globalAlpha = 1;
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(20,14,8,0.85)';
          ctx.lineWidth = f.px(2) + 2;
          ctx.beginPath();
          ctx.moveTo(px0, py0);
          ctx.quadraticCurveTo(px0 + rx * len * 0.5 + ry * len * 0.06, py0 + ry * len * 0.5 - rx * len * 0.06, px0 + rx * len, py0 + ry * len);
          ctx.stroke();
          ctx.strokeStyle = BELL.rope;
          ctx.lineWidth = f.px(2);
          ctx.stroke();
          ctx.lineCap = 'butt';
        }
      }
      // Gold rings to 12T over 1200 ms (easeOutCubic), line 0.12T -> 0.02T, alpha 0.6 -> 0.
      ctx.strokeStyle = 'rgb(232,200,114)';
      for (let r = 0; r < it.rings; r++) {
        const t = (age - r * it.ringDelay) / it.ringLife;
        if (t <= 0 || t >= 1) continue;
        const k = easeOutCubic(t);
        ctx.globalAlpha = 0.6 * (1 - t);
        ctx.lineWidth = Math.max(1, (0.12 - 0.1 * k) * T);
        ctx.beginPath();
        ctx.arc(cx * T, cy * T, Math.max(1, 12 * T * k), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Projectiles and lightning of the active hit step (stateless: from step progress). */
  function drawActiveStep(f: GfxFrame): void {
    const a = f.input.active;
    if (!a || a.step.event.type !== 'damaged') return;
    const e = a.step.event;
    const p = a.progress;
    const { ctx, T } = f;
    if (e.cause === 'tempest') {
      if (p > 0.3) return;
      const x = (e.pos.x + 0.5) * T;
      const y1 = (e.pos.y + 0.82) * T;
      const flick = f.motion.reduced ? 0 : Math.floor(p * 12);
      bolt.build(x + T * 0.3 * (hash(e.pos.x, e.pos.y, 41) - 0.5), y1 - 3 * T, x, y1, 6, T * 0.28, hashString(e.targetId) * 1000 + flick);
      ctx.globalCompositeOperation = 'lighter';
      drawLightning(ctx, bolt, T, 1 - p / 0.3);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    if (e.cause !== 'attack') return;
    const src = findDU(f, e.sourceId);
    if (!src || manhattan(src.pos, e.pos) <= 1 || p >= 0.4) return;
    const sx = src.pos.x + 0.5;
    const sy = src.pos.y + 0.4;
    const tx = e.pos.x + 0.5;
    const ty = e.pos.y + 0.45;
    const q = p / 0.4;
    const hx = sx + (tx - sx) * q;
    const hy = sy + (ty - sy) * q;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const u = src.unit;
    ctx.globalCompositeOperation = 'lighter';
    if (u.rank === 'radiant') {
      // Accent orb r 0.08T with a 0.3T fading trail.
      const rgb = ACCENT[u.faction];
      const col = u.faction === 'rebel' ? FACTION.rebel.accent : FACTION.loyalist.accent;
      glows.draw(ctx, rgb, hx * T, hy * T, 0.32 * T, 0.8);
      ctx.fillStyle = col;
      for (let i = 4; i >= 1; i--) {
        const back = Math.min(q * len, 0.3 * (i / 4));
        ctx.globalAlpha = 0.5 * (1 - i / 5);
        ctx.beginPath();
        ctx.arc((hx - ux * back) * T, (hy - uy * back) * T, 0.08 * T * (1 - i / 6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hx * T, hy * T, 0.08 * T, 0, Math.PI * 2);
      ctx.fill();
    } else if (u.rank === 'ascendant') {
      // Short jagged arc in the character's mark colour (Varek: cyan).
      const col = MARK_BY_CHARACTER[u.character ?? ''] ?? (u.faction === 'rebel' ? FACTION.rebel.accent : FACTION.loyalist.accent);
      const back = Math.min(q * len, 0.85);
      const flick = f.motion.reduced ? 0 : Math.floor(f.now / 40);
      bolt.build((hx - ux * back) * T, (hy - uy * back) * T, hx * T, hy * T, 5, T * 0.09, hashString(u.id) * 997 + flick);
      drawLightning(ctx, bolt, T * 0.8, 1, col, '#ffffff');
      glows.draw(ctx, hexRgb(col), hx * T, hy * T, 0.35 * T, 0.7);
    } else {
      // Anything else that shoots: a pale bolt streak.
      ctx.strokeStyle = '#fff3d6';
      ctx.lineWidth = Math.max(1.5, T / 20);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo((hx - ux * Math.min(q * len, 0.4)) * T, (hy - uy * Math.min(q * len, 0.4)) * T);
      ctx.lineTo(hx * T, hy * T);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function burnedBridges(f: GfxFrame, fn: (id: string, tiles: readonly Pos[]) => void): void {
    for (const o of f.state.map.objects) {
      if (o.kind === 'bridge' && o.burned && !f.input.overrides.unburnedBridges[o.id]) fn(o.id, o.tiles);
    }
  }

  function getVignette(f: GfxFrame): HTMLCanvasElement | OffscreenCanvas | null {
    const key = `${f.width}x${f.height}`;
    if (vignette && vignetteKey === key) return vignette;
    const c = makeCanvas(f.width, f.height);
    const g = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (!c || !g) return null;
    const grad = g.createRadialGradient(f.width / 2, f.height / 2, 0.35 * Math.min(f.width, f.height), f.width / 2, f.height / 2, 0.75 * Math.max(f.width, f.height));
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, f.width, f.height);
    vignette = c;
    vignetteKey = key;
    return c;
  }

  // --- banner card (layer 15) ------------------------------------------------------------------

  function bannerCard(f: GfxFrame, b: Extract<Effect, { kind: 'banner' }>): { c: HTMLCanvasElement | OffscreenCanvas; pad: number } | null {
    const W = f.width;
    const H = f.height;
    const ch = Math.round(Math.max(f.px(70), Math.min(H * 0.2, f.T * 2.7)));
    const key = `${b.title}|${b.subtitle}|${b.color}|${b.tone ?? ''}|${b.emblem ?? ''}|${W}|${H}|${ch}`;
    if (bannerCanvas && key === bannerKey) return { c: bannerCanvas, pad: bannerPad };
    const pad = Math.round(ch * 0.35);
    const c = makeCanvas(W, ch + pad * 2);
    const g = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (!c || !g) return null;
    const serif = `Georgia, 'Times New Roman', serif`;
    const sans = `system-ui, -apple-system, 'Segoe UI', sans-serif`;
    const titleSize = Math.round(ch * 0.4);
    const subSize = Math.max(f.px(10), Math.round(ch * 0.15));
    g.font = `700 ${titleSize}px ${serif}`;
    const tw = g.measureText(b.title).width;
    g.font = `600 ${subSize}px ${sans}`;
    const sw = g.measureText(b.subtitle.toUpperCase()).width * 1.25;
    const cw = Math.round(Math.min(W * 0.86, Math.max(f.T * 9, tw + ch * 2.4, sw + ch * 1.6)));
    const x0 = Math.round((W - cw) / 2);
    const y0 = pad;
    // Soft band across the board behind the card.
    const band = g.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, 'rgba(4,4,8,0)');
    band.addColorStop(0.25, 'rgba(4,4,8,0.45)');
    band.addColorStop(0.75, 'rgba(4,4,8,0.45)');
    band.addColorStop(1, 'rgba(4,4,8,0)');
    g.fillStyle = band;
    g.fillRect(0, y0 + ch * 0.12, W, ch * 0.76);
    // Card with drop shadow.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = pad * 0.9;
    g.shadowOffsetY = pad * 0.2;
    const bg = g.createLinearGradient(0, y0, 0, y0 + ch);
    bg.addColorStop(0, '#17141f');
    bg.addColorStop(1, '#0f0d15');
    g.fillStyle = bg;
    g.fillRect(x0, y0, cw, ch);
    g.restore();
    const lw = Math.max(1, f.px(1));
    // Outer border in the tone colour, inner ring (cards: inset 4px dark + 5px gold 0.22).
    g.globalAlpha = 0.85;
    g.strokeStyle = b.color;
    g.lineWidth = lw;
    g.strokeRect(x0 + lw / 2, y0 + lw / 2, cw - lw, ch - lw);
    g.globalAlpha = 0.25;
    const inset = f.px(5);
    g.strokeRect(x0 + inset + lw / 2, y0 + inset + lw / 2, cw - 2 * inset - lw, ch - 2 * inset - lw);
    g.globalAlpha = 1;
    // Corner diamonds.
    g.fillStyle = b.color;
    const dm = Math.max(2, f.px(3));
    for (const [cx, cy] of [
      [x0 + inset, y0 + inset],
      [x0 + cw - inset, y0 + inset],
      [x0 + inset, y0 + ch - inset],
      [x0 + cw - inset, y0 + ch - inset],
    ] as const) {
      g.beginPath();
      g.moveTo(cx, cy - dm);
      g.lineTo(cx + dm, cy);
      g.lineTo(cx, cy + dm);
      g.lineTo(cx - dm, cy);
      g.closePath();
      g.fill();
    }
    // Title with a soft glow.
    const midX = W / 2;
    const titleY = y0 + ch * 0.42;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${titleSize}px ${serif}`;
    g.save();
    g.shadowColor = b.color;
    g.shadowBlur = ch * 0.22;
    g.globalAlpha = 0.45;
    g.fillStyle = b.color;
    g.fillText(b.title, midX, titleY);
    g.restore();
    g.fillStyle = b.color;
    g.fillText(b.title, midX, titleY);
    // Rule with a centred diamond.
    const ruleY = Math.round(y0 + ch * 0.66);
    const rw = Math.min(cw * 0.6, Math.max(tw, ch * 2));
    const rule = g.createLinearGradient(midX - rw / 2, 0, midX + rw / 2, 0);
    rule.addColorStop(0, 'rgba(156,131,68,0)');
    rule.addColorStop(0.5, b.color);
    rule.addColorStop(1, 'rgba(156,131,68,0)');
    g.fillStyle = rule;
    g.globalAlpha = 0.7;
    g.fillRect(midX - rw / 2, ruleY, rw, lw);
    g.globalAlpha = 1;
    g.fillStyle = b.color;
    const rd = Math.max(2, f.px(3));
    g.beginPath();
    g.moveTo(midX, ruleY - rd + lw / 2);
    g.lineTo(midX + rd, ruleY + lw / 2);
    g.lineTo(midX, ruleY + rd + lw / 2);
    g.lineTo(midX - rd, ruleY + lw / 2);
    g.closePath();
    g.fill();
    // Subtitle, letter-spaced small caps.
    g.font = `600 ${subSize}px ${sans}`;
    g.fillStyle = COLORS.text;
    g.globalAlpha = 0.86;
    const spaced = 'letterSpacing' in g;
    if (spaced) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(subSize * 0.18)}px`;
    g.fillText(b.subtitle.toUpperCase(), midX, y0 + ch * 0.82);
    if (spaced) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
    g.globalAlpha = 1;
    // Emblems either side of the title.
    const em = b.emblem ?? 'diamond';
    const es = ch * 0.17;
    const ex = tw / 2 + ch * 0.45;
    for (const side of [-1, 1]) drawEmblem(g, em, midX + side * ex, titleY, es, b.color);
    bannerCanvas = c;
    bannerKey = key;
    bannerPad = pad;
    return { c, pad };
  }

  function drawBanner(f: GfxFrame, b: Extract<Effect, { kind: 'banner' }>, t: number): void {
    const card = bannerCard(f, b);
    if (!card) return;
    const { ctx } = f;
    const reduced = f.motion.reduced;
    const h = card.c.height;
    let alpha = 1;
    let dy = 0;
    if (t < 0.15) {
      const k = easeOutCubic(t / 0.15);
      alpha = k;
      dy = reduced ? 0 : (1 - k) * h * 0.08;
    } else if (t > 0.8) {
      const k = (t - 0.8) / 0.2;
      alpha = 1 - k;
      dy = reduced ? 0 : -easeInQuad(k) * h * 0.05;
    }
    ctx.globalAlpha = clamp01(alpha);
    ctx.drawImage(card.c as CanvasImageSource, 0, Math.round(f.height / 2 - h / 2 + dy));
    ctx.globalAlpha = 1;
  }

  // --- the pass object ----------------------------------------------------------------------------

  return {
    reset() {
      glows.clear();
      bannerCanvas = null;
      bannerKey = '';
      vignette = null;
      vignetteKey = '';
    },
    clear() {
      pool.clear();
      items = [];
      decals = [];
      burns.clear();
      shake = null;
      gameOverAt = -1;
      dustStep = null;
    },
    onStepStart(step: AnimStep, c: FxStepContext) {
      onStart(step, c);
    },
    onStepEnd(_step: AnimStep, _c: FxStepContext) {
      // Everything is scheduled at step start; poses end with the step.
    },
    computePoses,
    shakeOffset(f: GfxFrame) {
      shakeOut.x = 0;
      shakeOut.y = 0;
      const s = shake;
      if (!s) return shakeOut;
      const t = f.now - s.start;
      if (t > s.dur) {
        shake = null;
        return shakeOut;
      }
      const k = shakeScale(f.motion);
      // No shake while input is unlocked (6.2).
      if (t < 0 || k <= 0 || f.input.showHighlights) return shakeOut;
      const A = Math.min(f.px(s.ampCss), s.ampT * f.T) * k * Math.exp(-t / 70);
      const n = t * 0.03; // 30 Hz noise
      shakeOut.x = Math.round(A * valueNoise1D(n, s.seed));
      shakeOut.y = Math.round(A * valueNoise1D(n, s.seed + 17));
      return shakeOut;
    },
    drawDecals(f: GfxFrame) {
      const { ctx, T } = f;
      // Ash decals: ellipse 0.40T x 0.14T, rgba(20,18,22,0.25).
      if (decals.length > 0) {
        ctx.fillStyle = 'rgb(20,18,22)';
        for (const d of decals) {
          const a = 0.25 * clamp01((f.now - d.born) / d.fade);
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          ctx.beginPath();
          ctx.ellipse((d.x + 0.5) * T, (d.y + 0.82) * T, 0.2 * T, 0.07 * T, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // Burned bridges: scorch on the banks at both ends and 2 pulsing ember pixels per tile.
      const reduced = f.motion.reduced;
      const terrain = f.state.map.terrain;
      burnedBridges(f, (id, tiles) => {
        const inSpan = (x: number, y: number): boolean => tiles.some((t) => t.x === x && t.y === y);
        ctx.fillStyle = 'rgb(12,8,6)';
        for (const t of tiles) {
          for (const [dx, dy] of NEIGHBOURS) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            const ter = terrain[ny]?.[nx];
            if (!ter || ter === 'water' || ter === 'wall' || inSpan(nx, ny)) continue;
            ctx.globalAlpha = 0.22;
            ctx.beginPath();
            ctx.ellipse((nx + 0.5 - dx * 0.4) * T, (ny + 0.5 - dy * 0.4) * T, (dx === 0 ? 0.4 : 0.14) * T, (dy === 0 ? 0.4 : 0.14) * T, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        const sz = Math.max(1, Math.round(T / 18));
        ctx.fillStyle = BRIDGE.ember;
        const hs = hashString(id);
        for (const t of tiles) {
          for (let k = 0; k < 2; k++) {
            const h1 = hash(t.x, t.y, 60 + k);
            const h2 = hash(t.x, t.y, 70 + k);
            ctx.globalAlpha = reduced ? 0.8 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(f.now / 300 + h1 * 6.28 + hs));
            ctx.fillRect(Math.round((t.x + 0.2 + 0.6 * h1) * T), Math.round((t.y + 0.25 + 0.5 * h2) * T), sz, sz);
          }
        }
        ctx.globalAlpha = 1;
      });
    },
    collectLights(f: GfxFrame) {
      lightUsed = 0;
      const now = f.now;
      for (const it of items) {
        if (it.k === 'glow') {
          if (it.lr <= 0) continue;
          const t = (now - it.start) / it.life;
          if (t < 0 || t >= 1) continue;
          light(f, it.kind, it.x, it.y, it.lr, it.lk * (1 - easeOutQuad(t)), it.rgb);
        } else if (it.k === 'bell') {
          const t = (now - it.start) / it.life;
          if (t < 0 || t >= 1) continue;
          const bells = f.sites.bells;
          for (const b of bells) light(f, 'flash', b.x + 0.5, b.y + 0.5, 2.5, 0.6 * (1 - t), GOLD);
        }
      }
      // Burning bridges: r 2.6 k 0.9 for 6 s after the burn, then embers r 1.2 k 0.3.
      burnedBridges(f, (id, tiles) => {
        const rec = burns.get(id);
        const age = rec ? now - rec.start : Infinity;
        for (let i = 0; i < tiles.length; i++) {
          const t = tiles[i]!;
          const ig = rec?.ignite[i] ?? 0;
          const a = age - ig;
          if (a < 0) continue;
          if (a < BURN_MS) {
            const fade = a > BURN_MS - 1000 ? (BURN_MS - a) / 1000 : 1;
            const r = 1.2 + 1.4 * fade;
            const k = 0.3 + 0.6 * fade * Math.min(1, a / 150);
            light(f, 'fire', t.x + 0.5, t.y + 0.5, r, k, FIRE, 0.25, hash(t.x, t.y, 9));
          } else light(f, 'fire', t.x + 0.5, t.y + 0.5, 1.2, 0.3, FIRE, 0.25, hash(t.x, t.y, 9));
        }
      });
    },
    draw(f: GfxFrame) {
      const { ctx, T } = f;
      const now = f.now;
      setLimits(f.motion);
      pool.update(f.dt);

      // Game over: the vignette deepens by 0.15 (easeOutQuad) and stays.
      if (gameOverAt >= 0 && f.state.gameOver) {
        const v = getVignette(f);
        const k = 0.15 * easeOutQuad((now - gameOverAt) / gameOverDur);
        if (v && k > 0.005) {
          ctx.globalAlpha = k;
          ctx.drawImage(v as CanvasImageSource, -f.shake.x, -f.shake.y);
          ctx.globalAlpha = 1;
        }
      }

      // Burning bridges: ambient flames for 6 s (4/s per tile) and a soft ember glow afterwards.
      const amb = ambientAllowed(f.motion);
      ctx.globalCompositeOperation = 'lighter';
      burnedBridges(f, (id, tiles) => {
        const rec = burns.get(id);
        const age = rec ? now - rec.start : Infinity;
        if (rec && amb && age < BURN_MS) {
          rec.acc += f.dt;
          const every = 250;
          while (rec.acc >= every) {
            rec.acc -= every;
            for (let i = 0; i < tiles.length; i++) {
              const t = tiles[i]!;
              if (age < (rec.ignite[i] ?? 0)) continue;
              const h1 = hash(t.x, Math.floor(age / every), i + 31);
              const h2 = hash(t.y, Math.floor(age / every), i + 37);
              const fade = age > BURN_MS - 1500 ? (BURN_MS - age) / 1500 : 1;
              pool.spawn(t.x + 0.15 + 0.7 * h1, t.y + 0.45 + 0.35 * h2, (h1 - 0.5) * 0.25, -(0.7 + 0.6 * h2), 520 + 200 * h2, (0.06 + 0.05 * h1) * (0.5 + 0.5 * fade), RAMP.flame, P_ADD | P_AMBIENT | P_SHRINK, 0, -0.3, 0.4, 0.9);
            }
          }
        }
        for (let i = 0; i < tiles.length; i++) {
          const t = tiles[i]!;
          const a = age - (rec?.ignite[i] ?? 0);
          if (a < 0) continue;
          const burning = a < BURN_MS ? (a > BURN_MS - 1500 ? (BURN_MS - a) / 1500 : 1) : 0;
          const pulse = f.motion.reduced ? 1 : 0.8 + 0.2 * Math.sin(now / 260 + hash(t.x, t.y, 5) * 6.28);
          glows.draw(ctx, FIRE, (t.x + 0.5) * T, (t.y + 0.55) * T, (0.55 + 0.5 * burning) * T, (0.24 + 0.36 * burning) * pulse);
        }
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      // Timed items (rings, pulses, glows, bells); floats are drawn after the particles.
      let w = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const age = now - it.start;
        if (age >= it.life) continue;
        items[w++] = it;
        if (age < 0) continue;
        const t = age / it.life;
        switch (it.k) {
          case 'ring':
            drawRing(f, it, t);
            break;
          case 'diamond': {
            // Reduced motion: a fading outline at the Domain's size instead of an expanding pulse.
            const rad = (f.motion.reduced ? it.radius + 0.5 : 0.4 + t * (it.radius + 0.6)) * T;
            const cx = (it.x + 0.5) * T;
            const cy = (it.y + 0.5) * T;
            ctx.globalAlpha = 1 - t;
            ctx.strokeStyle = it.color;
            ctx.lineWidth = Math.max(2, T / 6) * (1 - t * 0.6);
            ctx.beginPath();
            ctx.moveTo(cx, cy - rad);
            ctx.lineTo(cx + rad, cy);
            ctx.lineTo(cx, cy + rad);
            ctx.lineTo(cx - rad, cy);
            ctx.closePath();
            ctx.stroke();
            ctx.globalAlpha = 1;
            break;
          }
          case 'glow':
            if (it.r > 0) {
              ctx.globalCompositeOperation = 'lighter';
              glows.draw(ctx, it.rgb, it.x * T, it.y * T, it.r * T * (0.8 + 0.4 * easeOutQuad(t)), it.a0 * (1 - easeOutQuad(t)));
              ctx.globalCompositeOperation = 'source-over';
              ctx.globalAlpha = 1;
            }
            break;
          case 'bell':
            drawBell(f, it);
            break;
          default:
            break;
        }
      }
      items.length = w;

      drawActiveStep(f);
      pool.draw(ctx, T);

      // Legacy controller effects (non-banner).
      for (const e of f.input.effects) {
        const t = (now - e.start) / e.life;
        if (t < 0 || t >= 1) continue;
        if (e.kind === 'float') drawFloat(f, e.pos.x, e.pos.y, e.text, e.color, e.big ?? false, now - e.start, t);
        else if (e.kind === 'pulse') {
          const rad = (0.4 + t * (e.radius + 0.6)) * T;
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(2, T / 6) * (1 - t * 0.6);
          ctx.beginPath();
          ctx.arc((e.center.x + 0.5) * T, (e.center.y + 0.5) * T, rad, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (e.kind === 'flash') {
          ctx.globalAlpha = (1 - t) * 0.6;
          ctx.fillStyle = e.color;
          for (const p of e.tiles) ctx.fillRect(p.x * T, p.y * T, T, T);
          ctx.globalAlpha = 1;
        }
      }
      // Floats on top of everything in layer 14.
      for (const it of items) {
        if (it.k !== 'float') continue;
        const age = now - it.start;
        if (age < 0) continue;
        drawFloat(f, it.x, it.y, it.text, it.color, it.big, age, age / it.life, it.small ?? false);
      }
    },
    drawBanner(f: GfxFrame) {
      for (const e of f.input.effects) {
        if (e.kind !== 'banner') continue;
        const t = (f.now - e.start) / e.life;
        if (t >= 0 && t < 1) drawBanner(f, e, t);
      }
    },
  };
}

/** Small banner emblem centred at (x, y), size s (half extent). */
function drawEmblem(g: CanvasRenderingContext2D, em: BannerEmblem, x: number, y: number, s: number, color: string): void {
  g.save();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, s * 0.22);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  switch (em) {
    case 'bell':
      g.moveTo(x - s * 0.75, y + s * 0.55);
      g.quadraticCurveTo(x - s * 0.6, y - s * 0.95, x, y - s * 0.95);
      g.quadraticCurveTo(x + s * 0.6, y - s * 0.95, x + s * 0.75, y + s * 0.55);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(x, y + s * 0.78, s * 0.2, 0, Math.PI * 2);
      g.fill();
      break;
    case 'dawn':
      g.arc(x, y + s * 0.35, s * 0.5, Math.PI, 0);
      g.closePath();
      g.fill();
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i + 0.5) * (Math.PI / 5);
        g.beginPath();
        g.moveTo(x + Math.cos(a) * s * 0.7, y + s * 0.35 + Math.sin(a) * s * 0.7);
        g.lineTo(x + Math.cos(a) * s, y + s * 0.35 + Math.sin(a) * s);
        g.stroke();
      }
      break;
    case 'rebel':
      g.moveTo(x, y - s);
      g.lineTo(x + s * 0.7, y);
      g.lineTo(x, y + s);
      g.lineTo(x - s * 0.7, y);
      g.closePath();
      g.fill();
      break;
    case 'loyalist':
      g.arc(x, y, s * 0.72, 0, Math.PI * 2);
      g.fill();
      break;
    case 'check':
      g.moveTo(x - s * 0.6, y);
      g.lineTo(x - s * 0.15, y + s * 0.5);
      g.lineTo(x + s * 0.65, y - s * 0.55);
      g.stroke();
      break;
    case 'cross':
      g.moveTo(x - s * 0.5, y - s * 0.5);
      g.lineTo(x + s * 0.5, y + s * 0.5);
      g.moveTo(x + s * 0.5, y - s * 0.5);
      g.lineTo(x - s * 0.5, y + s * 0.5);
      g.stroke();
      break;
    case 'diamond':
      g.moveTo(x, y - s * 0.6);
      g.lineTo(x + s * 0.6, y);
      g.lineTo(x, y + s * 0.6);
      g.lineTo(x - s * 0.6, y);
      g.closePath();
      g.fill();
      break;
  }
  g.restore();
}
