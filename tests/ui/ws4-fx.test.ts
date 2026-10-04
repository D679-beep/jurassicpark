import { describe, expect, it } from 'vitest';
import { outlineTiles } from '../../src/ui/gfx/domains';
import { deathPose, floatMotion, impactProgress, isBigHit, knockbackAt, lungeAt } from '../../src/ui/gfx/fx';
import {
  FX_AMBIENT_CAP,
  FX_POOL_CAP,
  P_AMBIENT,
  PARTICLE_CAP,
  AMBIENT_CAP,
  DOMAIN_AMBIENT_SHARE,
  ParticlePool,
  RAMPS,
  rampColor,
} from '../../src/ui/gfx/particles';

const hit = (amount: number, hpAfter: number, targetKind: 'unit' | 'object' = 'unit') =>
  ({ type: 'damaged', targetId: 't', targetKind, pos: { x: 0, y: 0 }, amount, hpBefore: hpAfter + amount, hpAfter, sourceId: 's', cause: 'attack', roll: 1 }) as const;

describe('particle budget (6.5)', () => {
  it('fx pool + Domain share stay within the hard caps', () => {
    expect(FX_POOL_CAP + DOMAIN_AMBIENT_SHARE).toBe(PARTICLE_CAP);
    expect(FX_AMBIENT_CAP + DOMAIN_AMBIENT_SHARE).toBe(AMBIENT_CAP);
  });

  it('never exceeds the cap; bursts recycle the oldest ambient particle', () => {
    const p = new ParticlePool();
    for (let i = 0; i < 10; i++) p.spawn(0, 0, 0, 0, 1000, 0.1, 0, P_AMBIENT);
    for (let i = 0; i < FX_POOL_CAP; i++) p.spawn(1, 1, 0, 0, 1000, 0.1, 0, 0);
    expect(p.count).toBe(FX_POOL_CAP);
    expect(p.ambientCount()).toBe(0);
    // Full of bursts: another burst still lands (recycles the oldest).
    expect(p.spawn(2, 2, 0, 0, 1000, 0.1, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(p.count).toBe(FX_POOL_CAP);
    // Ambient particles are dropped when nothing ambient can be recycled.
    expect(p.spawn(2, 2, 0, 0, 1000, 0.1, 0, P_AMBIENT)).toBe(-1);
  });

  it('caps ambient particles and honours reduced limits', () => {
    const p = new ParticlePool();
    for (let i = 0; i < 100; i++) p.spawn(0, 0, 0, 0, 1000, 0.1, 0, P_AMBIENT);
    expect(p.ambientCount()).toBe(FX_AMBIENT_CAP);
    p.clear();
    p.limits.cap = 40;
    p.limits.ambientCap = 0;
    for (let i = 0; i < 100; i++) p.spawn(0, 0, 0, 0, 1000, 0.1, 0, 0);
    expect(p.count).toBe(40);
    expect(p.spawn(0, 0, 0, 0, 1000, 0.1, 0, P_AMBIENT)).toBe(-1);
  });

  it('delayed particles wait, then move and expire with dt', () => {
    const p = new ParticlePool();
    p.spawn(0, 0, 1, 0, 100, 0.1, 0, 0, 50);
    p.update(40);
    expect(p.x[0]).toBe(0);
    p.update(20); // 10 ms past the delay
    expect(p.x[0]).toBeCloseTo(0.01, 5);
    p.update(200);
    expect(p.count).toBe(0);
  });

  it('colour ramps resolve to strings at both ends', () => {
    for (let r = 0; r < RAMPS.length; r++) {
      expect(rampColor(r, 0)).toMatch(/^rgb\(/);
      expect(rampColor(r, 1)).toMatch(/^rgb\(/);
    }
  });
});

describe('step motion curves (6.3)', () => {
  it('lunge peaks at impact and returns', () => {
    expect(lungeAt(0, 0.28)).toBe(0);
    expect(lungeAt(0.35, 0.28)).toBeCloseTo(0.28);
    expect(lungeAt(1, 0.28)).toBeCloseTo(0);
  });

  it('knockback starts at impact, peaks 0.2 later and settles', () => {
    expect(knockbackAt(0.3, 0.35, 0.12)).toBe(0);
    expect(knockbackAt(0.55, 0.35, 0.12)).toBeCloseTo(0.12);
    expect(Math.abs(knockbackAt(1, 0.35, 0.12))).toBeLessThan(1e-9);
    expect(knockbackAt(0.5, 0.35, 0)).toBe(0);
  });

  it('impact moments by cause and range', () => {
    expect(impactProgress(true, 'attack')).toBe(0.35);
    expect(impactProgress(false, 'attack')).toBe(0.4);
    expect(impactProgress(true, 'duel')).toBe(0.5);
  });

  it('big hits: 8+ damage or a kill, units only', () => {
    expect(isBigHit(hit(8, 2))).toBe(true);
    expect(isBigHit(hit(3, 0))).toBe(true);
    expect(isBigHit(hit(3, 5))).toBe(false);
    expect(isBigHit(hit(9, 0, 'object'))).toBe(false);
  });

  it('float numbers pop, rise 0.8T (0.3T reduced) and fade in the last 40 %', () => {
    const a = floatMotion(90, 0.1, false);
    expect(a.scale).toBeGreaterThan(1);
    expect(floatMotion(500, 1, false).rise).toBeCloseTo(0.8);
    expect(floatMotion(500, 1, true).rise).toBeCloseTo(0.3);
    expect(floatMotion(90, 0.1, true).scale).toBe(1);
    expect(floatMotion(500, 0.5, false).alpha).toBe(1);
    expect(floatMotion(500, 0.8, false).alpha).toBeCloseTo(0.5);
  });

  it('death: flash then tilt to 12 degrees, dissolve from the feet', () => {
    expect(deathPose(0).flash).toBeCloseTo(0.85);
    expect(deathPose(0.2).tilt).toBeCloseTo((12 * Math.PI) / 180);
    expect(deathPose(0.2).clip).toBe(0);
    expect(deathPose(1).clip).toBeCloseTo(1);
  });
});

describe('Domain outline', () => {
  it('outlines a radius-1 diamond as one loop of 12 corners and 12 unit sides', () => {
    const tiles = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
    ];
    const o = outlineTiles(tiles);
    expect(o.loops).toHaveLength(1);
    expect(o.loops[0]!.length / 2).toBe(12);
    expect(o.segs.length / 4).toBe(12);
  });

  it('keeps holes and separate pieces as separate loops', () => {
    const ring = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (x !== 1 || y !== 1) ring.push({ x, y });
    expect(outlineTiles(ring).loops).toHaveLength(2);
    expect(outlineTiles([{ x: 0, y: 0 }, { x: 5, y: 5 }]).loops).toHaveLength(2);
    expect(outlineTiles([]).loops).toHaveLength(0);
  });
});
