import { describe, expect, it } from 'vitest';
import type { AnimStep } from '../../src/ui/animation';
import { stepForEvent } from '../../src/ui/animation';
import {
  DEFAULT_SETTINGS,
  INSTANT_BANNER_MS,
  INSTANT_BELL_MS,
  INSTANT_DIALOGUE_MS,
  SETTINGS_KEY,
  SettingsStore,
  ambientAllowed,
  applySpeed,
  burstLimit,
  effectLifeScale,
  eraTransitionMs,
  isReduced,
  nextSpeed,
  parseSettings,
  particleCap,
  queueMultiplier,
  scaleStepDuration,
  shakeScale,
  speedLabel,
  type MediaQueryLike,
  type StorageLike,
} from '../../src/ui/settings';

const move = stepForEvent({ type: 'moved', unitId: 'a', from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] } as never);
const bell = stepForEvent({ type: 'bellRang', bell: 'firstBell', name: 'First Bell', round: 5 } as never);
const phase = stepForEvent({ type: 'phaseStarted', faction: 'rebel', phase: 'player', round: 2 } as never);
const talk = stepForEvent({ type: 'dialogue', speaker: 'Narrator', text: 'The bells ring over Calderon tonight.' } as never);

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

class FakeMedia implements MediaQueryLike {
  matches = false;
  private fns: (() => void)[] = [];
  addEventListener(_t: 'change', fn: () => void): void {
    this.fns.push(fn);
  }
  set(v: boolean): void {
    this.matches = v;
    for (const f of this.fns) f();
  }
}

describe('settings parsing', () => {
  it('falls back to defaults on missing or corrupt data', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"speed":"9x","reduceMotion":"maybe"}')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"speed":"instant","reduceMotion":"on"}')).toEqual({ speed: 'instant', reduceMotion: 'on' });
  });

  it('cycles speeds 1x -> 2x -> instant -> 1x with readable labels', () => {
    expect(nextSpeed('1x')).toBe('2x');
    expect(nextSpeed('2x')).toBe('instant');
    expect(nextSpeed('instant')).toBe('1x');
    expect(speedLabel('instant')).toBe('Instant');
    expect(speedLabel('2x')).toBe('2x');
  });

  it('resolves reduced motion from the preference and the system query', () => {
    expect(isReduced('system', true)).toBe(true);
    expect(isReduced('system', false)).toBe(false);
    expect(isReduced('on', false)).toBe(true);
    expect(isReduced('off', true)).toBe(false);
  });
});

describe('step scaling (6.4)', () => {
  it('leaves every step alone at 1x', () => {
    for (const s of [move, bell, phase, talk]) expect(scaleStepDuration(s, '1x')).toBe(s.duration);
    const steps = [move, bell];
    const out = applySpeed(steps, '1x');
    expect(out[0]).toBe(move);
    expect(out[1]).toBe(bell);
  });

  it('halves world steps at 2x and drops them at instant', () => {
    expect(queueMultiplier('2x')).toBe(0.5);
    expect(scaleStepDuration(move, '2x')).toBe(Math.round(move.duration * 0.5));
    expect(scaleStepDuration(move, 'instant')).toBe(0);
  });

  it('keeps banners and dialogue readable', () => {
    expect(scaleStepDuration(phase, '2x')).toBe(Math.round(phase.duration * 0.6));
    expect(scaleStepDuration(phase, 'instant')).toBe(INSTANT_BANNER_MS);
    expect(scaleStepDuration(bell, 'instant')).toBe(INSTANT_BELL_MS);
    expect(scaleStepDuration(talk, '2x')).toBe(Math.round(talk.duration * 0.75));
    expect(scaleStepDuration(talk, 'instant')).toBe(INSTANT_DIALOGUE_MS);
    expect(INSTANT_BANNER_MS).toBeGreaterThan(300);
  });

  it('applySpeed copies only the steps whose duration changes', () => {
    const steps: AnimStep[] = [move, bell];
    const out = applySpeed(steps, 'instant');
    expect(out[0]).not.toBe(move);
    expect(out[0]!.duration).toBe(0);
    expect(out[0]!.event).toBe(move.event);
    expect(move.duration).toBeGreaterThan(0); // input not mutated
  });
});

describe('effect and motion helpers', () => {
  const full = { reduced: false, speed: '1x' } as const;
  const fast = { reduced: false, speed: '2x' } as const;
  const instant = { reduced: false, speed: 'instant' } as const;
  const reduced = { reduced: true, speed: '1x' } as const;

  it('scales effect lifetimes', () => {
    expect(effectLifeScale('float', '1x')).toBe(1);
    expect(effectLifeScale('flash', '2x')).toBe(0.6);
    expect(effectLifeScale('float', 'instant')).toBe(0.6);
  });

  it('turns shake off in reduced motion and at instant speed', () => {
    expect(shakeScale(full)).toBe(1);
    expect(shakeScale(fast)).toBe(0.7);
    expect(shakeScale(instant)).toBe(0);
    expect(shakeScale(reduced)).toBe(0);
  });

  it('caps particles', () => {
    expect(particleCap(full)).toBe(192);
    expect(particleCap(reduced)).toBe(40);
    expect(burstLimit(14, full)).toBe(14);
    expect(burstLimit(14, reduced)).toBe(4);
    expect(burstLimit(12, reduced, 'debris')).toBe(6);
    expect(burstLimit(6, instant, 'impact')).toBe(6);
    expect(burstLimit(6, instant)).toBe(0);
    expect(ambientAllowed(full)).toBe(true);
    expect(ambientAllowed(reduced)).toBe(false);
    expect(ambientAllowed(instant)).toBe(false);
  });

  it('crossfades eras faster in reduced motion', () => {
    expect(eraTransitionMs(full)).toBe(1500);
    expect(eraTransitionMs(reduced)).toBe(600);
  });
});

describe('SettingsStore', () => {
  it('loads, persists and notifies', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ speed: '2x', reduceMotion: 'system' }));
    const media = new FakeMedia();
    const store = new SettingsStore(storage, media);
    expect(store.motion).toEqual({ reduced: false, speed: '2x' });
    const seen: string[] = [];
    const off = store.subscribe((m) => seen.push(`${m.speed}/${m.reduced}`));
    expect(store.cycleSpeed()).toBe('instant');
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!)).toEqual({ speed: 'instant', reduceMotion: 'system' });
    media.set(true);
    expect(store.motion.reduced).toBe(true);
    store.setReduceMotion('off');
    expect(store.motion.reduced).toBe(false);
    off();
    store.setSpeed('1x');
    expect(seen).toEqual(['instant/false', 'instant/true', 'instant/false']);
  });

  it('keeps the motion object identity until something changes', () => {
    const store = new SettingsStore(null, null);
    const m = store.motion;
    store.setSpeed('1x');
    expect(store.motion).toBe(m);
    store.setSpeed('2x');
    expect(store.motion).not.toBe(m);
  });

  it('survives storage that throws', () => {
    const broken: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    const store = new SettingsStore(broken, null);
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    expect(() => store.setSpeed('2x')).not.toThrow();
    expect(store.motion.speed).toBe('2x');
  });
});
