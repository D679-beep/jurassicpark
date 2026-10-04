// GameEvent -> human-readable log line. Pure.
import type { GameEvent, OutcomeFlags } from '../engine';
import { DOMAIN_NAMES, type NameLookup } from './names';

export type LogTone =
  | 'move'
  | 'damage'
  | 'heal'
  | 'death'
  | 'domain'
  | 'bell'
  | 'objective'
  | 'fail'
  | 'dialogue'
  | 'phase'
  | 'info'
  | 'victory'
  | 'defeat';

export interface LogLine {
  text: string;
  tone: LogTone;
  /** Set on a plain AI move: the chronicle folds these into one "reposition" summary per phase. */
  reposition?: { faction: 'rebel' | 'loyalist'; unitId: string };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Log line for an event, or null for events that are not worth logging. */
export function describeEvent(e: GameEvent, name: NameLookup): LogLine | null {
  switch (e.type) {
    case 'moved':
    {
      const faction = name.aiFactionOf?.(e.unitId);
      if (faction) return { text: repositionText(faction, 1), tone: 'move', reposition: { faction, unitId: e.unitId } };
    }
      return { text: `${name(e.unitId)} moves to (${e.to.x},${e.to.y}).`, tone: 'move' };
    case 'damaged': {
      const who = name(e.targetId);
      const hp = `${e.hpBefore} → ${e.hpAfter}`;
      switch (e.cause) {
        case 'attack':
          return { text: `${name(e.sourceId)} hits ${who} for ${e.amount} (${hp}).`, tone: 'damage' };
        case 'tempest':
          return { text: `Tempest lashes ${who} for ${e.amount} (${hp}).`, tone: 'damage' };
        case 'pyre':
          return { text: `Pyre scorches ${who} for ${e.amount} (${hp}).`, tone: 'damage' };
        case 'duel':
          return { text: `${who} bleeds ${e.amount} in the duel (${hp}).`, tone: 'damage' };
      }
      return null;
    }
    case 'healed':
      return { text: `Sanctuary mends ${name(e.unitId)} for ${e.amount} (now ${e.hpAfter}).`, tone: 'heal' };
    case 'died':
      if (e.cause === 'confront') return { text: `${e.name} is dead. The throne is empty.`, tone: 'death' };
      if (e.killerId) return { text: `${e.name} is slain by ${name(e.killerId)}.`, tone: 'death' };
      return { text: `${e.name} falls.`, tone: 'death' };
    case 'objectDestroyed':
      return e.objectKind === 'door'
        ? { text: `${name(e.objectId)} is broken open.`, tone: 'info' }
        : { text: `${name(e.objectId)} shatters.`, tone: 'info' };
    case 'domainActivated':
      return {
        text: `${name(e.unitId)} unleashes ${DOMAIN_NAMES[e.domain]} (until round ${e.expiresAtRound}).`,
        tone: 'domain',
      };
    case 'domainEnded':
      if (e.reason === 'ownerRemoved') return { text: `${DOMAIN_NAMES[e.domain]} collapses with its owner.`, tone: 'domain' };
      return {
        text: `${name(e.unitId)}'s ${DOMAIN_NAMES[e.domain]} fades${e.drained ? `; ${name(e.unitId)} is Drained` : ''}.`,
        tone: 'domain',
      };
    case 'bellRang':
      return e.bell === 'dawn'
        ? { text: `Dawn breaks over Calderon (round ${e.round}).`, tone: 'bell' }
        : { text: `The ${e.name} rings (round ${e.round}).`, tone: 'bell' };
    case 'bellsDelayed':
      if (e.reason === 'bellTower') {
        return { text: `Bell tower seized: the remaining bells are delayed ${plural(e.amount, 'round')}.`, tone: 'objective' };
      }
      return { text: `Bridges burned: the Second Bell knights are delayed ${plural(e.amount, 'round')}.`, tone: 'objective' };
    case 'reinforcementsArrived': {
      const base = `${e.name} arrives: ${plural(e.units.length, 'unit')}.`;
      const extra = e.blocked.length > 0 ? ` ${e.blocked.length} could not enter.` : '';
      return { text: base + extra, tone: 'bell' };
    }
    case 'objectiveCompleted':
      return { text: `Objective complete: ${e.name}.`, tone: 'objective' };
    case 'objectiveFailed':
      return { text: `Objective failed: ${e.name} (${e.reason}).`, tone: 'fail' };
    case 'captured':
      return { text: `${name(e.byUnitId)} takes ${name(e.unitId)} prisoner.`, tone: 'objective' };
    case 'escaped':
      return { text: `${name(e.unitId)} escapes the palace.`, tone: 'fail' };
    case 'bridgeBurned':
      return e.cause === 'pyre'
        ? { text: `Pyre burns the ${name(e.bridgeId)}.`, tone: 'info' }
        : { text: `${name(e.byUnitId)} burns the ${name(e.bridgeId)}.`, tone: 'info' };
    case 'sealBroken':
      return e.reason === 'anchors'
        ? { text: 'The ward anchors are gone. The Wellspring seal breaks.', tone: 'fail' }
        : { text: 'The Second Bell shatters the Wellspring seal.', tone: 'fail' };
    case 'duelEnded':
      return e.reason === 'leftFeastHall'
        ? { text: `The Feast Hall duel is broken: ${name(e.unitIds[0])} and ${name(e.unitIds[1])} are free.`, tone: 'info' }
        : { text: 'The Feast Hall duel is over.', tone: 'info' };
    case 'phaseStarted':
      return e.phase === 'player'
        ? { text: `Round ${e.round}: ${factionName(e.faction)} phase.`, tone: 'phase' }
        : { text: `${factionName(e.faction)} phase.`, tone: 'phase' };
    case 'gameOver':
      return { text: `${e.result === 'victory' ? 'Victory' : 'Defeat'}: ${e.reason}.`, tone: e.result };
    case 'dialogue':
      return { text: `${e.speaker}: “${e.text}”`, tone: 'dialogue' };
  }
}

export function repositionText(faction: 'rebel' | 'loyalist', count: number): string {
  return `${faction === 'rebel' ? 'Rebels' : 'Loyalists'} reposition (${plural(count, 'unit')}).`;
}

/**
 * The chronicle as a pure model. Plain AI moves are folded into a single summary
 * entry per phase (updated in place as more units move); every other line is its own entry.
 */
export class ChronicleLog {
  private summary: { entry: LogLine; units: Set<string> } | null = null;

  /** Adds a line. Returns the entry it landed in and whether that entry is new (else it was updated in place). */
  push(line: LogLine): { entry: LogLine; isNew: boolean } {
    if (line.tone === 'phase') this.summary = null;
    const r = line.reposition;
    if (!r) return { entry: line, isNew: true };
    if (!this.summary || this.summary.entry.reposition?.faction !== r.faction) {
      this.summary = { entry: { ...line }, units: new Set([r.unitId]) };
      return { entry: this.summary.entry, isNew: true };
    }
    this.summary.units.add(r.unitId);
    this.summary.entry.text = repositionText(r.faction, this.summary.units.size);
    return { entry: this.summary.entry, isNew: false };
  }

  reset(): void {
    this.summary = null;
  }
}

export function factionName(f: 'rebel' | 'loyalist'): string {
  return f === 'rebel' ? 'Rebel' : 'Loyalist';
}

/** Plain-language outcome flags for the result card. */
export function outcomeLines(o: OutcomeFlags): string[] {
  const lines: string[] = [];
  lines.push(o.emperorKilled ? 'Emperor Halden is dead.' : 'Emperor Halden still lives.');
  switch (o.elianOutcome) {
    case 'killed':
      lines.push('Crown Prince Elian was killed.');
      break;
    case 'escaped':
      lines.push("Crown Prince Elian escaped through the servants' tunnel.");
      break;
    case 'alive':
      lines.push('Crown Prince Elian is still inside the palace.');
      break;
  }
  switch (o.miraOutcome) {
    case 'captured':
      lines.push('Princess Mira is your prisoner, alive.');
      break;
    case 'escaped':
      lines.push('Princess Mira escaped the palace.');
      break;
    case 'dead':
      lines.push('Princess Mira is dead.');
      break;
    case 'free':
      lines.push('Princess Mira is still free.');
      break;
  }
  return lines;
}
