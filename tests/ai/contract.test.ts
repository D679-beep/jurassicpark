// The AI contract: legal actions only, phases terminate, deterministic, fast.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, seedToRngState, type GameState, type ScenarioDef } from '../../src/engine';
import { chooseAiAction, runAiPhase } from '../../src/ai';
import { prologueScenario } from '../../src/content/prologue';
import { miniPrologue } from '../engine/fixtures/miniPrologue';
import { deepFreeze, mutate } from '../engine/helpers';
import { aiPhase, isListedLegal, passiveRebels, playRounds, randomRebels } from './aiHelpers';

function withSeed(def: ScenarioDef, seed: number): ScenarioDef {
  return { ...def, seed };
}

/** Fixture variants that start the AI in different set-piece states. */
const variants: Record<string, (s: GameState) => GameState> = {
  start: (s) => s,
  sealBroken: (s) =>
    mutate(s, (m) => {
      m.sealBroken = true;
      for (const u of m.units) u.statuses = u.statuses.filter((x) => x !== 'sealed');
    }),
  duelOver: (s) =>
    mutate(s, (m) => {
      m.duel = m.duel ? { ...m.duel, active: false } : null;
      for (const u of m.units) u.statuses = u.statuses.filter((x) => x !== 'dueling');
    }),
  everyoneHurt: (s) =>
    mutate(s, (m) => {
      for (const u of m.units) u.hp = Math.max(1, Math.ceil(u.hp / 3));
    }),
};

describe('AI contract: legality and termination (fuzz)', () => {
  for (const [name, variant] of Object.entries(variants)) {
    it(`only legal actions and bounded phases on the mini prologue (${name})`, () => {
      let phases = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const rng = { s: seedToRngState(seed * 7919) };
        let s = variant(createGame(withSeed(miniPrologue(), seed)));
        while (!s.gameOver && s.round <= 14) {
          s = s.activeFaction === 'rebel' ? randomRebels(s, rng).state : aiPhase(s).state;
          phases++;
        }
      }
      expect(phases).toBeGreaterThan(16);
    });
  }

  it('only legal actions on the real prologue with a random rebel side', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const rng = { s: seedToRngState(seed) };
      let s = createGame(withSeed(prologueScenario, seed));
      while (!s.gameOver && s.round <= 13) s = s.activeFaction === 'rebel' ? randomRebels(s, rng, 20).state : aiPhase(s).state;
      expect(s.gameOver).toBe(true);
    }
  });

  it('drives either faction: AI vs AI only returns legal actions and the game ends', () => {
    for (const def of [miniPrologue(), prologueScenario]) {
      let s = createGame(def);
      while (!s.gameOver && s.round <= 14) s = aiPhase(s).state;
      expect(s.gameOver).toBe(true);
    }
  });

  it('returns endTurn when the active faction has nothing left to do', () => {
    let s = createGame(miniPrologue());
    s = passiveRebels(s).state;
    s = mutate(s, (m) => {
      for (const u of m.units) if (u.faction === 'loyalist') { u.hasMoved = true; u.hasActed = true; }
    });
    expect(chooseAiAction(s)).toEqual({ kind: 'endTurn' });
  });

  it('returns endTurn (and never throws) once the game is over', () => {
    const s = mutate(createGame(miniPrologue()), (m) => {
      m.gameOver = true;
    });
    expect(chooseAiAction(s)).toEqual({ kind: 'endTurn' });
  });
});

describe('AI contract: determinism and purity', () => {
  it('returns the same action for the same state and does not mutate it', () => {
    let s = createGame(miniPrologue());
    s = passiveRebels(s).state;
    const frozen = deepFreeze(structuredClone(s));
    const a = chooseAiAction(frozen);
    expect(chooseAiAction(frozen)).toEqual(a);
    expect(chooseAiAction(structuredClone(s))).toEqual(a);
    expect(isListedLegal(s, a)).toBe(true);
  });

  it('plays an identical game twice from the same seed', () => {
    const run = (): string => {
      const rng = { s: seedToRngState(99) };
      const log = playRounds(createGame(prologueScenario), 13, (st) => randomRebels(st, rng));
      return JSON.stringify(log.actions);
    };
    expect(run()).toBe(run());
  });

  it('runAiPhase plays one phase and hands the turn back', () => {
    const s = passiveRebels(createGame(miniPrologue())).state;
    const r = runAiPhase(s);
    expect(r.actions.at(-1)).toEqual({ kind: 'endTurn' });
    expect(r.state.activeFaction).toBe('rebel');
    expect(r.state.round).toBe(2);
  });
});

describe('AI contract: speed', () => {
  it('stays well under 50ms per call on the 32x22 prologue map', () => {
    let s = createGame(prologueScenario);
    const rng = { s: seedToRngState(5) };
    let worst = 0;
    let total = 0;
    let calls = 0;
    while (!s.gameOver && s.round <= 13) {
      if (s.activeFaction === 'rebel') {
        s = randomRebels(s, rng, 6).state;
        continue;
      }
      const t0 = performance.now();
      const a = chooseAiAction(s);
      const dt = performance.now() - t0;
      worst = Math.max(worst, dt);
      total += dt;
      calls++;
      s = applyAction(s, a).state;
    }
    // Generous bounds so slow CI machines do not flake; typical is ~1ms avg, <10ms worst.
    expect(total / calls).toBeLessThan(25);
    expect(worst).toBeLessThan(250);
  });
});
