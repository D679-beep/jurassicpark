// Balance regression: a few seeded runs of the scripted strategies from the
// balance simulator (scripts/sim) against the real Loyalist AI. These pin the
// headline properties from docs/design/prologue-map.md, "Balance log" (v0.3,
// Rebel-favoured). Full tables: `npm run sim`.
import { describe, expect, it } from 'vitest';
import { runGame } from '../../scripts/sim/harness';
import { charge, chargePinned, endTurnOnly, fullSweep, sweepBell, varekRush } from '../../scripts/sim/strategies';

const SEEDS = [1, 7920];
const SLOW = 60_000;

describe('prologue balance (seeded sims vs the Loyalist AI)', () => {
  it(
    'ending the turn every round loses at Dawn; Elian and Mira both escape by round 8; idle Grimm loses the duel',
    () => {
      const r = runGame(endTurnOnly, SEEDS[0]!);
      expect(r.result).toBe('defeat');
      expect(r.reason).toMatch(/Dawn/);
      expect(r.confrontRound).toBeNull();
      expect(r.elian).toBe('escaped');
      expect(r.mira).toBe('escaped');
      expect(r.elianRound!).toBeLessThanOrEqual(8);
      expect(r.miraRound!).toBeLessThanOrEqual(8);
      // Left to auto-duel, Grimm still holds Orsa past round 5, then falls.
      expect(r.duelWinner).toBe('orsa');
      expect(r.grimmDiedRound!).toBeGreaterThan(5);
    },
    SLOW,
  );

  it(
    'the Varek rush wins in rounds 6-8 and Kaela takes Mira alive',
    () => {
      for (const seed of SEEDS) {
        const r = runGame(varekRush, seed);
        expect(r.result, `seed ${seed}`).toBe('victory');
        expect(r.confrontRound, `seed ${seed}`).not.toBeNull();
        expect(r.confrontRound!).toBeGreaterThanOrEqual(6);
        expect(r.confrontRound!).toBeLessThanOrEqual(8);
        expect(r.mira, `seed ${seed}`).toBe('captured');
      }
    },
    SLOW,
  );

  it(
    'the full three-objective sweep can win with all three: Emperor confronted, Elian killed, Mira captured',
    () => {
      const r = runGame(fullSweep, 15839);
      expect(r.result).toBe('victory');
      expect(r.confrontRound).not.toBeNull();
      expect(r.elian).toBe('killed');
      expect(r.mira).toBe('captured');
    },
    SLOW,
  );

  it(
    'seizing the bell tower turns a sweep the plain plan loses at Dawn into a three-objective win',
    () => {
      const plain = runGame(fullSweep, SEEDS[0]!);
      expect(plain.result).toBe('defeat');
      expect(plain.reason).toMatch(/Dawn/);
      const bell = runGame(sweepBell, SEEDS[0]!);
      expect(bell.bellTowerRound).not.toBeNull();
      expect(bell.result).toBe('victory');
      expect(bell.elian).toBe('killed');
      expect(bell.mira).toBe('captured');
    },
    SLOW,
  );

  it(
    'an all-in charge (Grimm walks out of the duel too) can win or lose',
    () => {
      const win = runGame(charge, 1);
      expect(win.result).toBe('victory');
      const loss = runGame(charge, 7920);
      expect(loss.result).toBe('defeat');
      expect(loss.reason).toMatch(/Kaela/);
    },
    SLOW,
  );

  it(
    'Grimm fighting back from the pillars usually wins the duel, but not always',
    () => {
      expect(runGame(chargePinned, 1).duelWinner).toBe('grimm');
      expect(runGame(chargePinned, 7920).duelWinner).toBe('orsa');
    },
    SLOW,
  );
});
