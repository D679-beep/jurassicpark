import { describe, expect, it } from 'vitest';
import type { CharacterId, Faction, Rank } from '../../src/engine';
import { badgeLayout, badgeRadius, paintBadge, unitBadges, type BadgeKind } from '../../src/ui/gfx/badges';
import {
  FEET,
  FIGURE_TOP,
  drawnCharacter,
  figureKey,
  figureTypeKey,
  heightFactor,
  paintBody,
  paintGround,
  tabFontSize,
  type FigureSpec,
} from '../../src/ui/gfx/figures';
import { FakeContext, asCtx } from './ws3-fakeCanvas';

const RANKS: Rank[] = ['soldier', 'kindled', 'radiant', 'ascendant'];
const FACTIONS: Faction[] = ['rebel', 'loyalist'];
const NAMED: [Faction, Rank, CharacterId][] = [
  ['rebel', 'ascendant', 'varek'],
  ['rebel', 'kindled', 'kaela'],
  ['rebel', 'ascendant', 'grimm'],
  ['loyalist', 'soldier', 'halden'],
  ['loyalist', 'ascendant', 'elian'],
  ['loyalist', 'ascendant', 'orsa'],
  ['loyalist', 'radiant', 'mira'],
];

function allSpecs(): FigureSpec[] {
  const out: FigureSpec[] = [];
  for (const faction of FACTIONS) for (const rank of RANKS) out.push({ faction, rank, character: null });
  for (const [faction, rank, character] of NAMED) out.push({ faction, rank, character });
  return out;
}

describe('figure keys (5.1)', () => {
  it('distinguish faction, rank, character, variant, part, facing, T and dpr', () => {
    const keys = new Set<string>();
    let n = 0;
    for (const s of allSpecs())
      for (const v of ['normal', 'shade', 'spent', 'flash'] as const)
        for (const facing of [1, -1] as const)
          for (const T of [30, 46]) {
            keys.add(figureKey(s, 'body', v, facing, T, 1));
            n++;
          }
    expect(keys.size).toBe(n);
    const s: FigureSpec = { faction: 'rebel', rank: 'soldier', character: null };
    expect(figureKey(s, 'body', 'normal', 1, 46, 1)).not.toBe(figureKey(s, 'body', 'normal', 1, 46, 2));
    expect(figureKey(s, 'body', 'normal', 1, 46, 1)).toMatch(/^rebel\|soldier\|-\|normal\|46/);
  });

  it('ground sprites ignore facing; unknown characters share their rank figure', () => {
    const s: FigureSpec = { faction: 'loyalist', rank: 'kindled', character: null };
    expect(figureKey(s, 'ground', 'normal', 1, 30, 1)).toBe(figureKey(s, 'ground', 'normal', -1, 30, 1));
    const sereth: FigureSpec = { faction: 'loyalist', rank: 'kindled', character: 'sereth' };
    expect(figureTypeKey(sereth, 30, 1)).toBe(figureTypeKey(s, 30, 1));
    expect(drawnCharacter('sereth')).toBeNull();
    expect(drawnCharacter('mira')).toBe('mira');
  });
});

describe('rank heights (5.3)', () => {
  it('orders Soldier < Kindled = Radiant < Ascendant, Halden smallest', () => {
    const h = (rank: Rank, character: CharacterId | null = null): number => heightFactor({ faction: 'rebel', rank, character });
    expect(h('soldier')).toBeLessThan(h('kindled'));
    expect(h('kindled')).toBe(h('radiant'));
    expect(h('radiant')).toBeLessThan(h('ascendant'));
    expect(h('ascendant')).toBe(1);
    expect(h('soldier', 'halden')).toBeLessThan(h('soldier'));
  });
});

describe('painters stay inside the tile (5.1: nothing outside the tile)', () => {
  for (const T of [30, 46, 60, 92]) {
    it(`every figure at T=${T}`, () => {
      for (const s of allSpecs()) {
        for (const facing of [1, -1] as const) {
          const g = new FakeContext();
          paintBody(asCtx(g), s, T, facing);
          const b = g.bounds;
          const label = `${s.faction}/${s.rank}/${s.character ?? '-'}/${facing}`;
          expect(b.minX, label).toBeGreaterThanOrEqual(0);
          expect(b.maxX, label).toBeLessThanOrEqual(T);
          expect(b.minY, label).toBeGreaterThanOrEqual(0);
          // The body stands on the feet line (boots/hem may touch it).
          expect(b.maxY, label).toBeLessThanOrEqual(FEET * T + Math.max(2, T * 0.05));
          // Tall marks stay near the top but inside: within FIGURE_TOP - 2 % (stroke slack).
          expect(b.minY / T, label).toBeGreaterThanOrEqual(FIGURE_TOP - 0.03);
        }
        const g = new FakeContext();
        paintGround(asCtx(g), s, T);
        expect(g.bounds.minX).toBeGreaterThanOrEqual(0);
        expect(g.bounds.maxX).toBeLessThanOrEqual(T);
        expect(g.bounds.maxY).toBeLessThanOrEqual(T);
      }
    });
  }

  it('mirrored figures cover the mirrored extent', () => {
    const s: FigureSpec = { faction: 'loyalist', rank: 'soldier', character: null };
    const r = new FakeContext();
    const l = new FakeContext();
    paintBody(asCtx(r), s, 46, 1);
    paintBody(asCtx(l), s, 46, -1);
    expect(l.bounds.minX).toBeCloseTo(46 - r.bounds.maxX, 5);
    expect(l.bounds.maxX).toBeCloseTo(46 - r.bounds.minX, 5);
  });

  it('the spear reaches the top of the tile, the Soldier head sits lower than the Ascendant head', () => {
    const top = (s: FigureSpec): number => {
      const g = new FakeContext();
      paintBody(asCtx(g), s, 46, 1);
      return g.bounds.minY / 46;
    };
    expect(top({ faction: 'loyalist', rank: 'soldier', character: null })).toBeLessThan(0.08);
    expect(top({ faction: 'rebel', rank: 'soldier', character: null })).toBeGreaterThan(top({ faction: 'rebel', rank: 'ascendant', character: null }));
  });
});

describe('initial tab (5.4)', () => {
  it('uses max(9 css px, 0.22T)', () => {
    expect(tabFontSize(30, 1)).toBe(9);
    expect(tabFontSize(46, 1)).toBe(10);
    expect(tabFontSize(60, 2)).toBe(18);
    expect(tabFontSize(92, 1)).toBe(20);
  });
});

describe('status badges (5.5)', () => {
  const u = (statuses: ('sealed' | 'dueling' | 'drained')[], tags: string[] = []) => ({ statuses, tags });

  it('orders sealed, dueling, drained, escapee; escapee only while not sealed', () => {
    const out: BadgeKind[] = [];
    expect(unitBadges(u(['drained', 'dueling', 'sealed'], ['escapee']), out)).toEqual(['sealed', 'dueling', 'drained']);
    expect(unitBadges(u([], ['escapee']), out)).toEqual(['escapee']);
    expect(unitBadges(u(['sealed'], ['escapee']), out)).toEqual(['sealed']);
    expect(unitBadges(u([]), out)).toEqual([]);
  });

  it('radius is max(5.5 css px, 0.14T)', () => {
    expect(badgeRadius(30, 1)).toBe(5.5);
    expect(badgeRadius(60, 2)).toBe(11);
    expect(badgeRadius(92, 1)).toBeCloseTo(12.88, 5);
  });

  it('layout stays in the tile, right to left, and never runs into the initial tab', () => {
    for (const [T, dpr] of [
      [30, 1],
      [46, 1],
      [60, 2],
    ] as const) {
      const r = badgeRadius(T, dpr);
      const tabRight = Math.ceil(tabFontSize(T, dpr) * 1.15) + 1;
      for (let n = 1; n <= 4; n++) {
        const pos = badgeLayout(n, T, r, tabRight, []);
        expect(pos.length).toBe(2 * n);
        for (let i = 0; i < n; i++) {
          const x = pos[2 * i] as number;
          const y = pos[2 * i + 1] as number;
          expect(x + r).toBeLessThanOrEqual(T);
          expect(x - r).toBeGreaterThanOrEqual(tabRight);
          expect(y - r).toBeGreaterThanOrEqual(0);
          for (let j = 0; j < i; j++) {
            const d = Math.hypot(x - (pos[2 * j] as number), y - (pos[2 * j + 1] as number));
            expect(d).toBeGreaterThanOrEqual(2 * r);
          }
        }
      }
      // Without a tab, two badges sit side by side on the top edge.
      const two = badgeLayout(2, T, r, 0, []);
      expect(two[1]).toBe(two[3]);
      expect(two[2] as number).toBeLessThan(two[0] as number);
    }
  });

  it('paints every badge inside its circle', () => {
    for (const kind of ['sealed', 'dueling', 'drained', 'escapee'] as const) {
      for (const r of [5.5, 6.44, 11, 12.88]) {
        const g = new FakeContext();
        paintBadge(asCtx(g), kind, 20, 20, r);
        expect(g.bounds.minX, kind).toBeGreaterThanOrEqual(20 - r - 1e-6);
        expect(g.bounds.maxX, kind).toBeLessThanOrEqual(20 + r + 1e-6);
        expect(g.bounds.minY, kind).toBeGreaterThanOrEqual(20 - r - 1e-6);
        expect(g.bounds.maxY, kind).toBeLessThanOrEqual(20 + r + 1e-6);
      }
    }
  });
});
