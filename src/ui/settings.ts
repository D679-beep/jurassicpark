// Animation speed and reduced-motion settings (visual-style.md 6.4).
// Owner: WS0 (Foundation). The store persists to localStorage (wrapped in
// try/catch: private windows and blocked storage just fall back to the
// defaults) and follows `prefers-reduced-motion`. The scaling helpers are
// pure so they can be unit-tested; WS4 uses them for effect lifetimes,
// particles and shake.
import type { AnimStep } from './animation';
import type { Motion, Speed } from './gfx/types';

export type { Motion, Speed };

export type ReduceMotionPref = 'system' | 'on' | 'off';

export interface Settings {
  speed: Speed;
  reduceMotion: ReduceMotionPref;
}

export const SETTINGS_KEY = 'lantern.settings.v1';
export const SPEEDS: readonly Speed[] = ['1x', '2x', 'instant'];
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({ speed: '1x', reduceMotion: 'system' });

const REDUCE_PREFS: readonly ReduceMotionPref[] = ['system', 'on', 'off'];

/** Parses stored JSON; anything missing or invalid falls back to the defaults. */
export function parseSettings(raw: string | null | undefined): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>> | null;
    if (v && typeof v === 'object') {
      if (SPEEDS.includes(v.speed as Speed)) out.speed = v.speed as Speed;
      if (REDUCE_PREFS.includes(v.reduceMotion as ReduceMotionPref)) out.reduceMotion = v.reduceMotion as ReduceMotionPref;
    }
  } catch {
    // corrupt value: defaults
  }
  return out;
}

export function nextSpeed(s: Speed): Speed {
  const i = SPEEDS.indexOf(s);
  return SPEEDS[(i + 1) % SPEEDS.length] ?? '1x';
}

/** Button label (7.3). */
export function speedLabel(s: Speed): string {
  return s === 'instant' ? 'Instant' : s;
}

/** Effective reduced motion for a preference and the system media query. */
export function isReduced(pref: ReduceMotionPref, systemReduced: boolean): boolean {
  return pref === 'on' || (pref === 'system' && systemReduced);
}

// --- pure scaling helpers (6.4) ----------------------------------------------------

/** Queue duration multiplier for world steps (multiplied with the controller's AI speed). */
export function queueMultiplier(speed: Speed): number {
  return speed === '1x' ? 1 : speed === '2x' ? 0.5 : 0;
}

/** Fixed banner durations at `instant` speed: short but still readable. */
export const INSTANT_BANNER_MS = 450;
export const INSTANT_BELL_MS = 700;
export const INSTANT_DIALOGUE_MS = 700;

/**
 * Duration of a step at a speed, from its 1x duration (which already
 * includes the AI speed factor). World steps scale with `queueMultiplier`;
 * banners and dialogue stay readable (6.4 table).
 */
export function scaleStepDuration(step: Pick<AnimStep, 'kind' | 'duration' | 'event'>, speed: Speed): number {
  const d = step.duration;
  if (speed === '1x') return d;
  if (step.kind === 'banner') {
    if (speed === '2x') return Math.round(d * 0.6);
    return step.event.type === 'bellRang' ? INSTANT_BELL_MS : INSTANT_BANNER_MS;
  }
  if (step.kind === 'dialogue') return speed === '2x' ? Math.round(d * 0.75) : INSTANT_DIALOGUE_MS;
  return Math.round(d * queueMultiplier(speed));
}

/** Steps re-timed for a speed (new objects only where the duration changes). */
export function applySpeed(steps: readonly AnimStep[], speed: Speed): AnimStep[] {
  return steps.map((s) => {
    const duration = scaleStepDuration(s, speed);
    return duration === s.duration ? s : { ...s, duration };
  });
}

export type EffectKind = 'float' | 'flash' | 'pulse' | 'particle' | 'ring';

/** Lifetime multiplier for effects that outlive their step (6.4). */
export function effectLifeScale(kind: EffectKind, speed: Speed): number {
  if (speed === '1x') return 1;
  if (speed === '2x') return 0.6;
  return kind === 'float' ? 0.6 : 0.4;
}

/** Screen-shake amplitude multiplier: none in reduced motion or at instant speed (6.2, 6.4). */
export function shakeScale(m: Motion): number {
  if (m.reduced || m.speed === 'instant') return 0;
  return m.speed === '2x' ? 0.7 : 1;
}

/** Hard cap on live particles (6.5). */
export function particleCap(m: Motion): number {
  return m.reduced ? 40 : 192;
}

/** Ambient emitters (wind, embers, motes, footstep dust) run only at full motion and not at instant speed. */
export function ambientAllowed(m: Motion): boolean {
  return !m.reduced && m.speed !== 'instant';
}

/**
 * How many particles a burst may spawn. Reduced motion caps bursts at 4
 * (6 for break debris); at instant speed only impact sparks and break
 * debris spawn at all.
 */
export function burstLimit(requested: number, m: Motion, kind: 'impact' | 'debris' | 'other' = 'other'): number {
  if (m.speed === 'instant' && kind === 'other') return 0;
  if (m.reduced) return Math.min(requested, kind === 'debris' ? 6 : 4);
  return requested;
}

/** Idle bob, flicker, drifting patterns. */
export function idleMotionAllowed(m: Motion): boolean {
  return !m.reduced;
}

/** Duration of the global light transition at a bell (3.4): 600 ms linear crossfade in reduced motion. */
export function eraTransitionMs(m: Motion): number {
  return m.reduced ? 600 : 1500;
}

// --- the store ----------------------------------------------------------------------

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MediaQueryLike {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  addListener?(listener: () => void): void;
}

export type SettingsListener = (motion: Motion, settings: Readonly<Settings>) => void;

export class SettingsStore {
  private current: Settings;
  private motionValue: Motion;
  private readonly listeners = new Set<SettingsListener>();

  constructor(
    private readonly storage: StorageLike | null = null,
    private readonly media: MediaQueryLike | null = null,
  ) {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(SETTINGS_KEY) ?? null;
    } catch {
      raw = null;
    }
    this.current = parseSettings(raw);
    this.motionValue = this.computeMotion();
    const onChange = (): void => this.refresh();
    try {
      if (media?.addEventListener) media.addEventListener('change', onChange);
      else media?.addListener?.(onChange);
    } catch {
      // old browsers: no live updates
    }
  }

  /** The store for the page: window.localStorage and the reduced-motion media query, when available. */
  static fromWindow(): SettingsStore {
    let storage: StorageLike | null = null;
    let media: MediaQueryLike | null = null;
    try {
      storage = typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      storage = null;
    }
    try {
      media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    } catch {
      media = null;
    }
    return new SettingsStore(storage, media);
  }

  get settings(): Readonly<Settings> {
    return this.current;
  }

  /** Effective motion (a new object only when something changed, so it can be compared by identity). */
  get motion(): Motion {
    return this.motionValue;
  }

  setSpeed(speed: Speed): void {
    if (speed === this.current.speed) return;
    this.current = { ...this.current, speed };
    this.persist();
    this.refresh();
  }

  cycleSpeed(): Speed {
    this.setSpeed(nextSpeed(this.current.speed));
    return this.current.speed;
  }

  setReduceMotion(reduceMotion: ReduceMotionPref): void {
    if (reduceMotion === this.current.reduceMotion) return;
    this.current = { ...this.current, reduceMotion };
    this.persist();
    this.refresh();
  }

  /** Called with the new motion and settings on every change; returns an unsubscribe function. */
  subscribe(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private computeMotion(): Motion {
    let sys = false;
    try {
      sys = this.media?.matches ?? false;
    } catch {
      sys = false;
    }
    return { reduced: isReduced(this.current.reduceMotion, sys), speed: this.current.speed };
  }

  private refresh(): void {
    const m = this.computeMotion();
    if (m.reduced !== this.motionValue.reduced || m.speed !== this.motionValue.speed) this.motionValue = m;
    for (const fn of [...this.listeners]) fn(this.motionValue, this.current);
  }

  private persist(): void {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.current));
    } catch {
      // storage full or blocked: keep the in-memory value
    }
  }
}
