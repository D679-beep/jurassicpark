// Content of the "How to play" dialog. Pure. Objectives, bells and reinforcement
// waves come from the live GameState; the numbers in the rules lines come from
// the engine's RULES table, so a rules change does not leave this text stale.
// The sentences themselves (RULE_LINES) describe the current rules and are the
// part to reread when the rules change.
import { RULES, upcomingWaves, type GameState } from '../engine';
import { objectiveRows, type ObjectiveRow } from './hudModel';

export interface ControlRow {
  keys: string[];
  text: string;
}

export interface ControlGroup {
  group: string;
  rows: ControlRow[];
}

/** Every control the game responds to. Keep in step with controller.ts bindInput and the README. */
export const CONTROLS: readonly ControlGroup[] = [
  {
    group: 'Mouse',
    rows: [
      { keys: ['Click'], text: 'a rebel to select it, a blue tile to move there, a red target to attack it.' },
      {
        keys: ['Click'],
        text: 'an amber target to interact: the Emperor to Confront (Varek), a weakened Mira to Capture (Kaela), a bridge to burn it.',
      },
      { keys: ['Click'], text: 'the Emperor from a distance: Varek walks beside him first, then Confronts, if he can reach him this turn.' },
      { keys: ['Shift', 'Click'], text: 'attack instead of interact when a target offers both.' },
      { keys: ['Hover'], text: 'a target for its damage forecast or what an interaction does; an enemy for the tiles it can reach.' },
    ],
  },
  {
    group: 'Keyboard',
    rows: [
      { keys: ['Tab', 'Shift+Tab'], text: 'select the next / previous ready unit.' },
      { keys: ['W'], text: 'Wait: the selected unit is done for this turn.' },
      { keys: ['U', 'Ctrl+Z'], text: 'undo the last move, until a unit acts or the turn ends.' },
      { keys: ['E'], text: 'end your turn (twice, if units can still act).' },
      { keys: ['T'], text: 'show or hide the tiles the loyalists can attack next turn.' },
      { keys: ['S'], text: 'cycle the animation speed.' },
      { keys: ['H', '?'], text: 'open or close this help.' },
      { keys: ['Esc'], text: 'deselect, or close a dialog.' },
    ],
  },
];

export interface BellRow {
  name: string;
  round: number;
  rung: boolean;
}

export interface WaveRow {
  name: string;
  units: number;
  round: number;
}

export interface HelpModel {
  objectives: ObjectiveRow[];
  bells: BellRow[];
  /** Reinforcement waves that have not arrived yet, soonest first. */
  waves: WaveRow[];
  rules: string[];
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The rules in a few lines. Numbers are read from RULES. */
export function ruleLines(): string[] {
  const bonus = Math.round((RULES.ascendantBonus - 1) * 100);
  return [
    'Each unit gets one move and one action per turn, in either order. The action is an attack, a Domain, an interaction or Wait.',
    `Only an Ascendant can really hurt an Ascendant: damage from anyone else is capped at ${RULES.nonAscendantCap} per hit. Ascendants deal ${bonus}% more damage to everyone else.`,
    `Each Ascendant has one Domain per battle: a radius-${RULES.domainRadius} area that lasts ${plural(RULES.domainDuration, 'round')}. Afterwards they are Drained for the rest of the battle (-${RULES.drainAtk} ATK, -${RULES.drainMove} move).`,
    'Terrain matters: rubble, pillars, tables and crates slow movement but give cover. Walls and water block it, and barred doors have to be broken.',
  ];
}

export function helpModel(state: GameState): HelpModel {
  return {
    objectives: objectiveRows(state),
    bells: [...state.bells].sort((a, b) => a.round - b.round).map((b) => ({ name: b.name, round: b.round, rung: b.rung })),
    waves: upcomingWaves(state)
      .filter((w) => Number.isFinite(w.round))
      .map((w) => ({ name: w.name, units: w.unitCount, round: w.round })),
    rules: ruleLines(),
  };
}
