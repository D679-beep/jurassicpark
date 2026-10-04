// gfx/lighting.ts and gfx/overlays.ts pure helpers (WS2): flicker, floor
// minimum, light level for the unit night shade, change detection, region
// edges and label sizing.
import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/engine';
import { prologueScenario } from '../../src/content';
import { ERA_LIGHT } from '../../src/ui/palette';
import { buildSites } from '../../src/ui/gfx/sites';
import {
  MAX_NIGHT_SHADE,
  anyFlicker,
  effectiveLight,
  flickerFactor,
  floorCarveAlpha,
  lightLevel,
  lightsHash,
  residualDarkness,
} from '../../src/ui/gfx/lighting';
import { domainLabelTile, edgeMask, labelFont } from '../../src/ui/gfx/overlays';
import type { EraLight, LightSource } from '../../src/ui/gfx/types';

const ERAS = ['Midnight', 'First Bell', 'Second Bell', 'Dawn'] as const;

function light(over: Partial<LightSource> = {}): LightSource {
  return { kind: 'lantern', x: 5.5, y: 5.5, radius: 2.7, intensity: 0.85, color: [255, 176, 90], flicker: 0.1, seed: 0.3, lamp: true, ...over };
}

function level(env: EraLight, tx: number, ty: number, lights: LightSource[], outdoor = false): number {
  const n = lights.length;
  const xs = lights.map((l) => l.x);
  const ys = lights.map((l) => l.y);
  const rs = lights.map((l) => l.radius);
  const ks = lights.map((l) => l.intensity * (l.lamp ? env.lamp : 1));
  const dk = lights.map((l) => (l.darken ? 1 : 0));
  return lightLevel(tx, ty, env, outdoor, n, xs, ys, rs, ks, dk);
}

describe('flicker (3.2)', () => {
  it('is exactly 1 with reduced motion or no amplitude', () => {
    for (let t = 0; t < 5; t += 0.37) {
      expect(flickerFactor(0.16, 0.42, t, true)).toBe(1);
      expect(flickerFactor(0, 0.42, t, false)).toBe(1);
    }
  });

  it('stays within 1 +- amp and actually varies', () => {
    const vals: number[] = [];
    for (let t = 0; t < 3; t += 0.05) vals.push(flickerFactor(0.1, 0.7, t, false));
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(v).toBeLessThanOrEqual(1.1 + 1e-9);
    }
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.05);
  });

  it('applies the era lamp factor only to lamp lights', () => {
    const dawn = ERA_LIGHT.Dawn;
    expect(effectiveLight(light(), dawn, 0, true).k).toBeCloseTo(0.85 * dawn.lamp);
    expect(effectiveLight(light({ lamp: false, kind: 'anchor' }), dawn, 0, true).k).toBeCloseTo(0.85);
    expect(effectiveLight(light(), dawn, 0, true).r).toBeCloseTo(2.7);
  });
});

describe('floor minimum (3.1, 3.4)', () => {
  it('caps unlit passable tiles at floorCap in every era', () => {
    for (const era of ERAS) {
      const env = ERA_LIGHT[era];
      expect(residualDarkness(env, false, true)).toBeCloseTo(Math.min(env.darkAlpha, env.floorCap));
      expect(residualDarkness(env, false, false)).toBeCloseTo(env.darkAlpha);
      // Moonlit open ground is lighter still.
      expect(residualDarkness(env, true, true)).toBeLessThanOrEqual(env.floorCap + 1e-9);
    }
  });

  it('carves nothing when floorCap >= darkAlpha', () => {
    expect(floorCarveAlpha(0.3, 0.3)).toBe(0);
    expect(floorCarveAlpha(0.3, 0.5)).toBe(0);
    expect(floorCarveAlpha(0, 0.5)).toBe(0);
    expect(floorCarveAlpha(0.68, 0.55)).toBeCloseTo(1 - 0.55 / 0.68);
  });

  it('keeps the darkness tint near neutral (no coloured haze)', () => {
    for (const era of ERAS) {
      const [r, g, b] = ERA_LIGHT[era].tint;
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(20);
    }
  });
});

describe('light level for the night shade (3.5)', () => {
  const mid = ERA_LIGHT.Midnight;

  it('is 1 - darkAlpha far from any light, plus moon outdoors', () => {
    expect(level(mid, 20, 20, [light()])).toBeCloseTo(1 - mid.darkAlpha);
    expect(level(mid, 20, 20, [light()], true)).toBeCloseTo(1 - mid.darkAlpha + 0.7 * mid.moon);
  });

  it('rises toward a light and is clamped to [0, 1]', () => {
    const near = level(mid, 5, 5, [light()]);
    const mid1 = level(mid, 6, 5, [light()]);
    expect(near).toBeGreaterThan(mid1);
    expect(mid1).toBeGreaterThan(1 - mid.darkAlpha);
    const many = Array.from({ length: 10 }, () => light());
    expect(level(mid, 5, 5, many)).toBe(1);
  });

  it('is lowered by Silence darkeners', () => {
    expect(level(mid, 5, 5, [light({ darken: true, lamp: false })])).toBeLessThan(1 - mid.darkAlpha);
  });

  it('never shades a unit past the cap', () => {
    for (const era of ERAS) {
      const L = level(ERA_LIGHT[era], 0, 0, []);
      expect(MAX_NIGHT_SHADE * (1 - L)).toBeLessThanOrEqual(MAX_NIGHT_SHADE);
      expect(MAX_NIGHT_SHADE).toBe(0.38);
    }
  });
});

describe('lightmap change detection (3.7)', () => {
  it('hash changes with lights and global light, not with object identity', () => {
    const a = [light(), light({ x: 9.5 })];
    const b = [light(), light({ x: 9.5 })];
    expect(lightsHash(a, ERA_LIGHT.Midnight)).toBe(lightsHash(b, ERA_LIGHT.Midnight));
    expect(lightsHash(a, ERA_LIGHT.Midnight)).not.toBe(lightsHash([light(), light({ x: 9.6 })], ERA_LIGHT.Midnight));
    expect(lightsHash(a, ERA_LIGHT.Midnight)).not.toBe(lightsHash(a, ERA_LIGHT['First Bell']));
    expect(lightsHash(a, ERA_LIGHT.Midnight)).not.toBe(lightsHash([light()], ERA_LIGHT.Midnight));
  });

  it('knows whether anything flickers', () => {
    expect(anyFlicker([light({ flicker: 0 })])).toBe(false);
    expect(anyFlicker([light({ flicker: 0 }), light()])).toBe(true);
  });

  it('the prologue has flickering static lights', () => {
    const s = createGame(prologueScenario);
    const sites = buildSites(s.map, s.scenarioId);
    expect(anyFlicker(sites.staticLights)).toBe(true);
  });
});

describe('overlay helpers', () => {
  it('edgeMask flags the sides that leave the set', () => {
    const set = new Set(['1,1', '2,1', '1,2']);
    const inside = (x: number, y: number): boolean => set.has(`${x},${y}`);
    expect(edgeMask(1, 1, inside)).toBe(1 | 8);
    expect(edgeMask(2, 1, inside)).toBe(1 | 2 | 4);
    expect(edgeMask(1, 2, inside)).toBe(2 | 4 | 8);
  });

  it('labels are at least 10 css px', () => {
    expect(labelFont(30, 1)).toBe(10);
    expect(labelFont(46, 1)).toBe(14);
    expect(labelFont(60, 2)).toBe(20);
    expect(labelFont(92, 2)).toBe(28);
  });

  it('Domain label sits on the bottom tip', () => {
    expect(domainLabelTile([{ x: 3, y: 1 }, { x: 3, y: 5 }, { x: 2, y: 4 }])).toEqual({ x: 3, y: 5 });
    expect(domainLabelTile([])).toBeNull();
  });
});
