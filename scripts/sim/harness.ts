// Balance simulator: plays scripted rebel strategies against the real
// Loyalist AI (runAiPhase) and records what happened.
import { applyAction, createGame, type GameEvent, type GameState, type ScenarioDef } from '../../src/engine';
import { runAiPhase } from '../../src/ai';
import { prologueScenario } from '../../src/content';
import { playUnit } from './kit';
import type { Memory, Strategy } from './strategies';

export interface RunResult {
  strategy: string;
  seed: number;
  result: 'victory' | 'defeat';
  reason: string;
  endRound: number;
  confrontRound: number | null;
  elian: 'killed' | 'escaped' | 'alive';
  elianRound: number | null;
  mira: 'captured' | 'escaped' | 'dead' | 'free';
  miraRound: number | null;
  rebelLosses: number;
  lost: string[];
  grimmDiedRound: number | null;
  orsaDiedRound: number | null;
  /** Grimm's HP when Orsa fell (null if she did not, or he was already gone). */
  grimmHpAtOrsaDeath: number | null;
  duelEndedRound: number | null;
  /** Who won the Feast Hall duel (the other duelist died while it held); null if it ended otherwise or never did. */
  duelWinner: 'grimm' | 'orsa' | null;
  sealBrokenRound: number | null;
  bellTowerRound: number | null;
  bridgesRound: number | null;
  /** Heroes downed / revived / bled out. */
  downs: number;
  revives: number;
  bledOut: number;
  /** Round the Third Bell wave (Southern Legion) arrived, if it did. */
  legionRound: number | null;
  /** Attacks between a Legion unit and a rebel (either way). */
  legionHits: number;
  /** Legion units killed. */
  legionKilled: number;
  /** Victory by rout (every loyalist down before Dawn) rather than at Dawn. */
  routed: boolean;
}

interface Tracker {
  round: number;
  r: RunResult;
  /** Unit ids of the Third Bell waves. */
  legion: Set<string>;
}

function track(t: Tracker, events: GameEvent[], s: GameState): void {
  const rebel = (id: string | null): boolean =>
    id !== null && (s.units.some((u) => u.id === id && u.faction === 'rebel') || s.removedUnits.some((x) => x.unit.id === id && x.unit.faction === 'rebel'));
  for (const e of events) {
    switch (e.type) {
      case 'phaseStarted':
        t.round = e.round;
        break;
      case 'downed':
        if (e.faction === 'rebel') t.r.downs++;
        break;
      case 'revived':
        t.r.revives++;
        break;
      case 'reinforcementsArrived':
        if (e.bell === 'thirdBell') t.r.legionRound ??= t.round;
        break;
      case 'damaged':
        if (e.cause === 'attack' && e.targetKind === 'unit') {
          if ((t.legion.has(e.targetId) && rebel(e.sourceId)) || (e.sourceId !== null && t.legion.has(e.sourceId) && rebel(e.targetId))) t.r.legionHits++;
        }
        break;
      case 'gameOver':
        t.r.routed = e.result === 'victory' && /routed/.test(e.reason);
        break;
      case 'died':
        if (t.legion.has(e.unitId)) t.r.legionKilled++;
        if (e.cause === 'bledOut') t.r.bledOut++;
        if (e.cause === 'confront') t.r.confrontRound = t.round;
        if (e.faction === 'rebel') {
          t.r.rebelLosses++;
          t.r.lost.push(e.unitId);
        }
        if (e.unitId === 'grimm') t.r.grimmDiedRound = t.round;
        if ((e.unitId === 'grimm' || e.unitId === 'orsa') && t.r.duelEndedRound === null && t.r.duelWinner === null) {
          t.r.duelWinner = e.unitId === 'grimm' ? 'orsa' : 'grimm';
        }
        if (e.unitId === 'orsa') {
          t.r.orsaDiedRound = t.round;
          const g = s.units.find((u) => u.id === 'grimm');
          t.r.grimmHpAtOrsaDeath = g ? g.hp : null;
        }
        if (e.unitId === 'elian') t.r.elianRound = t.round;
        if (e.unitId === 'mira') t.r.miraRound = t.round;
        break;
      case 'escaped':
        if (e.unitId === 'elian') t.r.elianRound = t.round;
        if (e.unitId === 'mira') t.r.miraRound = t.round;
        break;
      case 'captured':
        if (e.unitId === 'mira') t.r.miraRound = t.round;
        break;
      case 'duelEnded':
        t.r.duelEndedRound ??= t.round;
        break;
      case 'sealBroken':
        t.r.sealBrokenRound ??= t.round;
        break;
      case 'bellsDelayed':
        if (e.reason === 'bellTower') t.r.bellTowerRound ??= t.round;
        if (e.reason === 'bridges') t.r.bridgesRound ??= t.round;
        break;
      default:
    }
  }
}

/** Plays the rebel phase with the strategy, then ends the turn. */
export function playRebelPhase(s: GameState, strat: Strategy, mem: Memory): { state: GameState; events: GameEvent[] } {
  let state = s;
  const events: GameEvent[] = [];
  for (const id of strat.sequence(state, mem)) {
    if (state.gameOver) break;
    const r = playUnit(state, id, strat.order(state, id, mem));
    state = r.state;
    events.push(...r.events);
  }
  if (!state.gameOver) {
    const r = applyAction(state, { kind: 'endTurn' });
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

export interface RunOptions {
  scenario?: ScenarioDef;
  /** Hard stop (rounds); the scenario ends at Dawn anyway. */
  maxRounds?: number;
  /** Called after every phase (for tracing). */
  onPhase?: (s: GameState, events: GameEvent[]) => void;
}

export function runGame(strat: Strategy, seed: number, opts: RunOptions = {}): RunResult {
  const scenario = opts.scenario ?? prologueScenario;
  let s = createGame({ ...scenario, seed });
  const t: Tracker = {
    round: 1,
    legion: new Set(s.waves.filter((w) => w.bell === 'thirdBell').flatMap((w) => w.units.map((u) => u.id))),
    r: {
      strategy: strat.name,
      seed,
      result: 'defeat',
      reason: '',
      endRound: 0,
      confrontRound: null,
      elian: 'alive',
      elianRound: null,
      mira: 'free',
      miraRound: null,
      rebelLosses: 0,
      lost: [],
      grimmDiedRound: null,
      orsaDiedRound: null,
      grimmHpAtOrsaDeath: null,
      duelEndedRound: null,
      duelWinner: null,
      sealBrokenRound: null,
      bellTowerRound: null,
      bridgesRound: null,
      downs: 0,
      revives: 0,
      bledOut: 0,
      legionRound: null,
      legionHits: 0,
      legionKilled: 0,
      routed: false,
    },
  };
  const mem: Memory = {};
  const maxRounds = opts.maxRounds ?? 30;
  while (!s.gameOver && s.round <= maxRounds) {
    const r = s.activeFaction === s.playerFaction ? playRebelPhase(s, strat, mem) : runAiPhase(s);
    track(t, r.events, r.state);
    s = r.state;
    opts.onPhase?.(s, r.events);
  }
  t.r.endRound = s.round;
  t.r.result = s.result?.result ?? 'defeat';
  t.r.reason = s.result?.reason ?? 'unfinished';
  t.r.elian = s.outcome.elianOutcome;
  t.r.mira = s.outcome.miraOutcome;
  return t.r;
}

export interface Summary {
  strategy: string;
  runs: number;
  winRate: number;
  confrontRate: number;
  confrontMean: number | null;
  confrontMin: number | null;
  confrontMax: number | null;
  elianKilled: number;
  elianEscaped: number;
  elianEscapeMean: number | null;
  miraCaptured: number;
  miraEscaped: number;
  miraDead: number;
  miraEscapeMean: number | null;
  bothOptionals: number;
  /** Victory with Elian killed and Mira captured: all three objectives. */
  allThree: number;
  lossesMean: number;
  grimmDied: number;
  grimmDiedMean: number | null;
  orsaDied: number;
  orsaDiedMean: number | null;
  grimmHpAtOrsaDeath: number | null;
  duelEndMean: number | null;
  /** Duels won by Grimm / by Orsa (the rest ended with Grimm leaving, or were still going). */
  duelGrimm: number;
  duelOrsa: number;
  bellTower: number;
  bridges: number;
  /** Mean rounds played (the round the battle ended in). */
  roundsMean: number;
  /** Runs in which the Third Bell wave arrived / traded blows with the rebels. */
  legionArrived: number;
  legionFought: number;
  legionKilledMean: number;
  /** Mean heroes downed / revived per run; total bleed-outs. */
  downsMean: number;
  revivesMean: number;
  bledOut: number;
  /** Victories by rout (before Dawn). */
  routs: number;
  reasons: Record<string, number>;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(name: string, runs: RunResult[]): Summary {
  const confronts = runs.map((r) => r.confrontRound).filter((x): x is number => x !== null);
  const reasons: Record<string, number> = {};
  for (const r of runs) reasons[`${r.result}: ${r.reason}`] = (reasons[`${r.result}: ${r.reason}`] ?? 0) + 1;
  const pick = (f: (r: RunResult) => number | null): number[] => runs.map(f).filter((x): x is number => x !== null);
  return {
    strategy: name,
    runs: runs.length,
    winRate: runs.filter((r) => r.result === 'victory').length / runs.length,
    confrontRate: confronts.length / runs.length,
    confrontMean: mean(confronts),
    confrontMin: confronts.length ? Math.min(...confronts) : null,
    confrontMax: confronts.length ? Math.max(...confronts) : null,
    elianKilled: runs.filter((r) => r.elian === 'killed').length,
    elianEscaped: runs.filter((r) => r.elian === 'escaped').length,
    elianEscapeMean: mean(pick((r) => (r.elian === 'escaped' ? r.elianRound : null))),
    miraCaptured: runs.filter((r) => r.mira === 'captured').length,
    miraEscaped: runs.filter((r) => r.mira === 'escaped').length,
    miraDead: runs.filter((r) => r.mira === 'dead').length,
    miraEscapeMean: mean(pick((r) => (r.mira === 'escaped' ? r.miraRound : null))),
    bothOptionals: runs.filter((r) => r.elian === 'killed' && r.mira === 'captured').length,
    allThree: runs.filter((r) => r.result === 'victory' && r.elian === 'killed' && r.mira === 'captured').length,
    lossesMean: mean(runs.map((r) => r.rebelLosses)) ?? 0,
    grimmDied: runs.filter((r) => r.grimmDiedRound !== null).length,
    grimmDiedMean: mean(pick((r) => r.grimmDiedRound)),
    orsaDied: runs.filter((r) => r.orsaDiedRound !== null).length,
    orsaDiedMean: mean(pick((r) => r.orsaDiedRound)),
    grimmHpAtOrsaDeath: mean(pick((r) => r.grimmHpAtOrsaDeath)),
    duelEndMean: mean(pick((r) => r.duelEndedRound)),
    duelGrimm: runs.filter((r) => r.duelWinner === 'grimm').length,
    duelOrsa: runs.filter((r) => r.duelWinner === 'orsa').length,
    bellTower: runs.filter((r) => r.bellTowerRound !== null).length,
    bridges: runs.filter((r) => r.bridgesRound !== null).length,
    roundsMean: mean(runs.map((r) => r.endRound)) ?? 0,
    legionArrived: runs.filter((r) => r.legionRound !== null).length,
    legionFought: runs.filter((r) => r.legionHits > 0).length,
    legionKilledMean: mean(runs.map((r) => r.legionKilled)) ?? 0,
    downsMean: mean(runs.map((r) => r.downs)) ?? 0,
    revivesMean: mean(runs.map((r) => r.revives)) ?? 0,
    bledOut: runs.reduce((n, r) => n + r.bledOut, 0),
    routs: runs.filter((r) => r.routed).length,
    reasons,
  };
}

export function runMany(strat: Strategy, seeds: number[], opts: RunOptions = {}): RunResult[] {
  return seeds.map((seed) => runGame(strat, seed, opts));
}

export function seedList(n: number, base = 1): number[] {
  return Array.from({ length: n }, (_, i) => base + i * 7919);
}
