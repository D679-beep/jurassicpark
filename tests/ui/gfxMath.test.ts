import { describe, expect, it } from 'vitest';
import {
  clamp01,
  easeInOutSine,
  easeInQuad,
  easeOutBack,
  easeOutCubic,
  easeOutQuad,
  lerp,
  linear,
  segment,
  there,
} from '../../src/ui/gfx/ease';
import { hash, hashString, valueNoise1D, valueNoise2D } from '../../src/ui/gfx/noise';
import { ERA_LIGHT, blendEraLight } from '../../src/ui/palette';

describe('easing (6.1)', () => {
  const eases = { linear, easeInQuad, easeOutQuad, easeInOutSine, easeOutCubic, easeOutBack };

  it('maps 0 -> 0 and 1 -> 1 and clamps outside [0, 1]', () => {
    for (const [name, e] of Object.entries(eases)) {
      expect(e(0), name).toBeCloseTo(0, 9);
      expect(e(1), name).toBeCloseTo(1, 9);
      expect(e(-1), name).toBeCloseTo(0, 9);
      expect(e(2), name).toBeCloseTo(1, 9);
    }
  });

  it('is monotonic except for the overshooting easeOutBack', () => {
    for (const e of [linear, easeInQuad, easeOutQuad, easeInOutSine, easeOutCubic]) {
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const v = e(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = v;
      }
    }
    let peak = 0;
    for (let i = 0; i <= 100; i++) peak = Math.max(peak, easeOutBack(i / 100));
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.2);
  });

  it('has the expected shapes', () => {
    expect(easeInQuad(0.5)).toBeCloseTo(0.25);
    expect(easeOutQuad(0.5)).toBeCloseTo(0.75);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
  });

  it('helpers', () => {
    expect(clamp01(1.5)).toBe(1);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
    expect(segment(0.35, 0, 0.35)).toBe(1);
    expect(segment(0.5, 0.35, 1)).toBeCloseTo(0.15 / 0.65);
    expect(segment(0.1, 0.35, 1)).toBe(0);
    expect(there(0)).toBe(0);
    expect(there(0.5)).toBe(1);
    expect(there(1)).toBe(0);
  });
});

describe('noise', () => {
  it('hash is deterministic, in [0, 1) and salt-sensitive', () => {
    expect(hash(3, 7, 99)).toBe(hash(3, 7, 99));
    expect(hash(3, 7, 99)).not.toBe(hash(3, 7, 98));
    expect(hash(3, 7)).not.toBe(hash(7, 3));
    for (let x = -5; x < 40; x++) {
      for (let y = -5; y < 30; y++) {
        const v = hash(x, y, 11);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('hash keeps the pre-overhaul values (lantern placement and floor checker stay put)', () => {
    // Reference implementation copied from the old renderer.
    const old = (x: number, y: number, salt = 0): number => {
      let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
    for (const [x, y, s] of [
      [0, 0, 0],
      [15, 2, 99],
      [31, 21, 7],
      [4, 9, 1],
    ] as const) {
      expect(hash(x, y, s)).toBe(old(x, y, s));
    }
  });

  it('hashString is deterministic and spreads ids', () => {
    expect(hashString('varek')).toBe(hashString('varek'));
    expect(hashString('varek')).not.toBe(hashString('kaela'));
    expect(hashString('varek', 1)).not.toBe(hashString('varek', 2));
    const vs = ['a', 'b', 'c', 'wolf-s1', 'wolf-s2', 'g-throne-1'].map((s) => hashString(s));
    for (const v of vs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(vs).size).toBe(vs.length);
  });

  it('value noise is deterministic, bounded and continuous', () => {
    expect(valueNoise1D(3.3, 5)).toBe(valueNoise1D(3.3, 5));
    expect(valueNoise2D(1.25, 7.5, 2)).toBe(valueNoise2D(1.25, 7.5, 2));
    expect(valueNoise1D(4, 5)).toBeCloseTo(hash(4, 0, 5) * 2 - 1, 12);
    let prev = valueNoise1D(0, 9);
    for (let i = 1; i <= 400; i++) {
      const t = i / 40;
      const v = valueNoise1D(t, 9);
      const v2 = valueNoise2D(t, t * 0.7, 9);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v2)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.2);
      prev = v;
    }
  });
});

describe('era light (3.4)', () => {
  it('blends between eras and settles on the table rows', () => {
    const mid = blendEraLight(ERA_LIGHT.Midnight, ERA_LIGHT.Dawn, 0.5);
    expect(mid.darkAlpha).toBeCloseTo((0.68 + 0.3) / 2);
    expect(mid.desat).toBeCloseTo(0.225);
    expect(blendEraLight(ERA_LIGHT.Midnight, ERA_LIGHT.Dawn, 1)).toEqual(ERA_LIGHT.Dawn);
    expect(blendEraLight(ERA_LIGHT.Midnight, ERA_LIGHT.Dawn, 0)).toEqual(ERA_LIGHT.Midnight);
    const out = { ...ERA_LIGHT.Midnight };
    expect(blendEraLight(ERA_LIGHT.Midnight, ERA_LIGHT['First Bell'], 1, out)).toBe(out);
  });

  it('keeps floorCap at or below darkAlpha in every era (floor minimum, 3.1)', () => {
    for (const row of Object.values(ERA_LIGHT)) expect(row.floorCap).toBeLessThanOrEqual(row.darkAlpha);
    expect(ERA_LIGHT.Midnight.floorCap).toBeLessThanOrEqual(0.55);
  });
});
