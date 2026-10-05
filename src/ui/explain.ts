// "Why did nothing happen?": a short, plain-language reason for a click on a
// unit that is neither selectable nor a legal target. Pure.
import { attackTargetProblem, findUnit, reachableTiles, type GameState, type Unit } from '../engine';
import { emperorGuidance } from './guidance';

/** Engine problem strings (combat.ts attackTargetProblem) in the player's words. */
function attackProblemText(state: GameState, attacker: Unit, target: Unit): string | null {
  if (attacker.hasActed) return `${attacker.name} has already acted this turn.`;
  const problem = attackTargetProblem(state, attacker, target.id);
  switch (problem) {
    case null:
      return null;
    case 'target out of range': {
      const canReach =
        !attacker.hasMoved &&
        reachableTiles(state, attacker.id).some((t) => attackTargetProblem(state, attacker, target.id, t) === null);
      return canReach
        ? `${target.name} is out of range. Move ${attacker.name} closer first, then attack.`
        : `${target.name} is out of reach this turn.`;
    }
    case 'no line of sight':
      return `No line of sight to ${target.name}.`;
    case 'sealed target can only be harmed by an Ascendant':
      return `${target.name} is sealed: only an Ascendant can harm a sealed target.`;
    case 'a duelist may only attack the other duelist':
      return `${attacker.name} is locked in a duel and can only attack the other duelist.`;
    case 'target cannot be damaged by attacks':
      return `${target.name} cannot be damaged by attacks.`;
    case 'attacker cannot act':
      return `${attacker.name} cannot act right now.`;
    default:
      return problem.charAt(0).toUpperCase() + problem.slice(1) + '.';
  }
}

/**
 * Why clicking `occupant` did nothing. `selectedId` is the selected unit, if
 * any. Returns null when there is nothing useful to say.
 */
export function explainUnitClick(state: GameState, selectedId: string | null, occupant: Unit): string | null {
  if (occupant.faction === state.playerFaction) return `${occupant.name} has nothing left to do this turn.`;
  if (occupant.character === 'halden') {
    const g = emperorGuidance(state, selectedId);
    return g ? `The Emperor cannot be attacked. ${g.text}` : null;
  }
  const attacker = selectedId ? findUnit(state, selectedId) : undefined;
  return attacker ? attackProblemText(state, attacker, occupant) : null;
}
