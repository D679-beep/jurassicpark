// Balance regression: a few seeded runs of the scripted strategies from the
// balance simulator (scripts/sim) against the real Loyalist AI. These pin the
// headline properties from docs/design/prologue-map.md, "Balance log".
// Full tables: `npm run sim`.
import { describe, expect, it } from 'vitest';
import { runGame } from '../../scripts/sim/harness';
import { charge, endTurnOnly, varekRush } from '../../scripts/sim/strategies';

const SEEDS = [1, 7920];
const SLOW = 60_000;

describe('prologue balance (seeded sims vs the Loyalist AI)', () => {
  it(
    'ending the turn every round loses at Dawn, and Elian and Mira both escape by round 8',
    () => {
      const r = runGame(endTurnOnly, SEEDS[0]!);
      expect(r.result).toBe('defeat');
      expect(r.reason).toMatch(/Dawn/);
      expect(r.confrontRound).toBeNull();
      expect(r.elian).toBe('escaped');
      expect(r.mira).toBe('escaped');
      expect(r.elianRound!).toBeLessThanOrEqual(8);
      expect(r.miraRound!).toBeLessThanOrEqual(8);
      // Left to auto-duel, Grimm still holds Orsa past round 5.
      expect(r.grimmDiedRound!).toBeGreaterThan(5);
    },
    SLOW,
  );

  it(
    'the Varek rush wins the required objective in rounds 6-9, well before Dawn',
    () => {
      for (const seed of SEEDS) {
        const r = runGame(varekRush, seed);
        expect(r.result, `seed ${seed}`).toBe('victory');
        expect(r.confrontRound, `seed ${seed}`).not.toBeNull();
        expect(r.confrontRound!).toBeGreaterThanOrEqual(6);
        expect(r.confrontRound!).toBeLessThanOrEqual(9);
        // Grimm, fighting back from cover, outlasts Orsa.
        expect(r.grimmDiedRound, `seed ${seed}`).toBeNull();
      }
    },
    SLOW,
  );

  it(
    'an all-in charge (Grimm walks out of the duel too) loses',
    () => {
      const r = runGame(charge, SEEDS[0]!);
      expect(r.result).toBe('defeat');
    },
    SLOW,
  );
});
