import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Unit } from '../../src/engine';
import { createGame } from '../../src/engine';
import { ERA_LIGHT } from '../../src/ui/palette';
import { IDENTITY_POSE, type DisplayUnit, type GfxFrame, type UnitPose } from '../../src/ui/gfx/types';
import {
  HP_GHOST_MS,
  MAX_SHADE,
  bobOffset,
  createUnits,
  defaultFacing,
  ghostTop,
  hpBarRect,
  newHpTrack,
  shadeAlpha,
  sortByDisplay,
  trackHp,
  unitLook,
} from '../../src/ui/gfx/units';
import { FakeContext, asCtx, installFakeDocument } from './ws3-fakeCanvas';
import { uiScenario } from './fixture';

describe('HP damage ghost and heal flash (5.5)', () => {
  it('a drop leaves a ghost that shrinks to the new HP over 400 ms', () => {
    const t = newHpTrack();
    trackHp(t, 20, 0);
    expect(ghostTop(t, 20, 0)).toBe(20);
    trackHp(t, 12, 1000);
    expect(ghostTop(t, 12, 1000)).toBeCloseTo(20, 6);
    const mid = ghostTop(t, 12, 1000 + HP_GHOST_MS / 2);
    expect(mid).toBeLessThan(20);
    expect(mid).toBeGreaterThan(12);
    // easeOutQuad: past the linear midpoint.
    expect(mid).toBeLessThan(16);
    expect(ghostTop(t, 12, 1000 + HP_GHOST_MS)).toBe(12);
  });

  it('a second hit while the ghost shrinks keeps the visible ghost top', () => {
    const t = newHpTrack();
    trackHp(t, 30, 0);
    trackHp(t, 20, 100);
    const before = ghostTop(t, 20, 200);
    trackHp(t, 15, 200);
    expect(ghostTop(t, 15, 200)).toBeCloseTo(before, 6);
  });

  it('a gain starts the heal flash and cancels the ghost', () => {
    const t = newHpTrack();
    trackHp(t, 10, 0);
    trackHp(t, 5, 10);
    trackHp(t, 9, 20);
    expect(t.healFrom).toBe(5);
    expect(t.healStart).toBe(20);
    expect(ghostTop(t, 9, 30)).toBe(9);
  });
});

describe('unit look helpers', () => {
  it('night shade never exceeds 0.38 (3.5)', () => {
    expect(shadeAlpha(0)).toBe(MAX_SHADE);
    expect(shadeAlpha(-1)).toBe(MAX_SHADE);
    expect(shadeAlpha(1)).toBe(0);
    expect(shadeAlpha(0.5)).toBeCloseTo(0.19, 6);
  });

  it('idle bob amplitude is 0.015T', () => {
    let max = 0;
    for (let t = 0; t < 3000; t += 7) max = Math.max(max, Math.abs(bobOffset(46, t, 1.3)));
    expect(max).toBeLessThanOrEqual(0.015 * 46 + 1e-9);
    expect(max).toBeGreaterThan(0.014 * 46);
  });

  it('acted / spent only for the active faction', () => {
    const u = { faction: 'rebel' as const, hasMoved: true, hasActed: true };
    expect(unitLook(u, 'rebel', false, false)).toBe('spent');
    expect(unitLook({ ...u, hasMoved: false }, 'rebel', false, false)).toBe('acted');
    expect(unitLook(u, 'loyalist', false, false)).toBe('ready');
    expect(unitLook(u, 'rebel', true, false)).toBe('ready');
    expect(unitLook(u, 'rebel', false, true)).toBe('ready');
  });

  it('default facing: rebels right, loyalists left', () => {
    expect(defaultFacing('rebel')).toBe(1);
    expect(defaultFacing('loyalist')).toBe(-1);
  });

  it('sorts by display y then x, in place', () => {
    const a = [
      { id: 'a', x: 3, y: 2 },
      { id: 'b', x: 1, y: 5 },
      { id: 'c', x: 0, y: 2 },
      { id: 'd', x: 2, y: 2.5 },
    ];
    expect(sortByDisplay(a).map((p) => p.id)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('HP bar sits inside the tile, 0.72T wide, bottom 2 px above the edge', () => {
    for (const [T, dpr] of [
      [30, 1],
      [46, 1],
      [60, 2],
    ] as const) {
      const r = hpBarRect(T, dpr);
      expect(r.x).toBe(Math.round(0.14 * T));
      expect(r.w).toBe(Math.round(0.72 * T));
      expect(r.h).toBeGreaterThanOrEqual(3 * dpr);
      expect(r.y + r.h + 1).toBeLessThanOrEqual(T);
      expect(r.y - 1).toBeGreaterThan(0.75 * T);
    }
  });
});

describe('units pass (fake canvas)', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installFakeDocument();
  });
  afterEach(() => uninstall());

  function frame(units: DisplayUnit[], poses = new Map<string, UnitPose>(), reduced = false): { f: GfxFrame; ctx: FakeContext } {
    const state = createGame(uiScenario());
    const ctx = new FakeContext();
    const f = {
      ctx: asCtx(ctx),
      T: 46,
      dpr: 1,
      px: (n: number) => Math.round(n),
      width: 46 * 10,
      height: 46 * 7,
      mapW: 10,
      mapH: 7,
      now: 1000,
      dt: 16,
      motion: { reduced, speed: '1x' as const },
      era: { from: 'Midnight' as const, to: 'Midnight' as const, t: 1 },
      env: ERA_LIGHT.Midnight,
      input: {} as GfxFrame['input'],
      state,
      sites: {} as GfxFrame['sites'],
      units,
      domains: [],
      displayPos: (u: Unit) => u.pos,
      lights: [],
      poses,
      levelAt: () => 0.3,
      shake: { x: 0, y: 0 },
    } as GfxFrame;
    return { f, ctx };
  }

  function display(): DisplayUnit[] {
    const state = createGame(uiScenario());
    return state.units.map((u) => ({ unit: u, ghost: false, pos: u.pos, hp: u.hp, selected: false }));
  }

  it('draws each figure with at most 3 sprite blits plus tabs and badges', () => {
    const pass = createUnits();
    const units = display();
    const { f, ctx } = frame(units);
    pass.draw(f);
    const named = units.filter((d) => d.unit.character !== null).length;
    // ground + body + night shade per unit, plus initial tabs (no statuses in the fixture).
    expect(ctx.drawImages).toBe(3 * units.length + named);
  });

  it('pushes a Radiant orb light and a seal light, scaled by pose alpha', () => {
    const pass = createUnits();
    const units = display();
    const sealed = units[0] as DisplayUnit;
    const u = { ...sealed.unit, statuses: ['sealed' as const] };
    units[0] = { ...sealed, unit: u };
    const poses = new Map<string, UnitPose>([[u.id, { ...IDENTITY_POSE, alpha: 0.5 }]]);
    const { f } = frame(units, poses);
    pass.collectLights(f);
    const seal = f.lights.find((l) => l.kind === 'seal');
    const orb = f.lights.find((l) => l.kind === 'orb');
    expect(seal?.intensity).toBeCloseTo(0.3, 6);
    expect(orb).toBeDefined();
    expect(f.lights.length).toBe(2);
  });

  it('ghosts with a dissolved pose still draw (no fade of their own) and invisible ones skip', () => {
    const pass = createUnits();
    const units = display().slice(0, 1).map((d) => ({ ...d, ghost: true }));
    const id = (units[0] as DisplayUnit).unit.id;
    const vis = frame(units, new Map([[id, { ...IDENTITY_POSE, tilt: 0.2, clipFromFeet: 0.5 }]]));
    pass.draw(vis.f);
    expect(vis.ctx.drawImages).toBeGreaterThanOrEqual(2);
    const gone = frame(units, new Map([[id, { ...IDENTITY_POSE, alpha: 0 }]]));
    pass.draw(gone.f);
    expect(gone.ctx.drawImages).toBe(0);
  });
});
