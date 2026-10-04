// Event-driven animation model. Pure: GameEvents -> a queue of timed steps,
// plus "display overrides" so the renderer can draw the new state as it looked
// before each not-yet-played event (units at their old tile, old HP, removed
// units still visible, reinforcements hidden). Overrides are built only from
// the events and from looking units up in the previous state; states are
// never diffed.
import type { DomainKind, GameEvent, GameState, Pos, Unit } from '../engine';

export const TIMING = {
  moveStep: 85,
  hit: 280,
  heal: 240,
  death: 480,
  objectBreak: 320,
  domain: 750,
  domainEnd: 260,
  bell: 1500,
  delay: 1300,
  arrive: 850,
  objective: 1100,
  remove: 480,
  burn: 480,
  seal: 800,
  duel: 600,
  phasePlayer: 750,
  phaseAi: 550,
  gameOver: 400,
  dialogueMin: 1400,
  dialogueMax: 3800,
  dialoguePerChar: 32,
} as const;

export type StepKind =
  | 'move'
  | 'hit'
  | 'heal'
  | 'death'
  | 'remove'
  | 'objectBreak'
  | 'domain'
  | 'domainEnd'
  | 'banner'
  | 'arrive'
  | 'burn'
  | 'seal'
  | 'dialogue'
  | 'pause';

export interface AnimStep {
  kind: StepKind;
  /** Milliseconds the queue waits on this step. */
  duration: number;
  event: GameEvent;
  /** Banner text for 'banner' steps. */
  banner?: { title: string; subtitle: string; tone: 'bell' | 'objective' | 'fail' | 'phase' | 'info' };
  domain?: DomainKind;
}

export function dialogueDuration(text: string): number {
  return Math.max(TIMING.dialogueMin, Math.min(TIMING.dialogueMax, TIMING.dialogueMin + text.length * TIMING.dialoguePerChar * 0.5));
}

/** One step per event, with a duration suited to its animation. */
export function stepForEvent(e: GameEvent, speed = 1): AnimStep {
  const d = (ms: number): number => Math.round(ms * speed);
  switch (e.type) {
    case 'moved':
      return { kind: 'move', duration: d(TIMING.moveStep * Math.max(1, e.path.length)), event: e };
    case 'damaged':
      return { kind: 'hit', duration: d(TIMING.hit), event: e };
    case 'healed':
      return { kind: 'heal', duration: d(TIMING.heal), event: e };
    case 'died':
      return { kind: 'death', duration: d(TIMING.death), event: e };
    case 'captured':
    case 'escaped':
      return { kind: 'remove', duration: d(TIMING.remove), event: e };
    case 'objectDestroyed':
      return { kind: 'objectBreak', duration: d(TIMING.objectBreak), event: e };
    case 'domainActivated':
      return { kind: 'domain', duration: d(TIMING.domain), event: e, domain: e.domain };
    case 'domainEnded':
      return { kind: 'domainEnd', duration: d(TIMING.domainEnd), event: e, domain: e.domain };
    case 'bellRang':
      return {
        kind: 'banner',
        duration: d(TIMING.bell),
        event: e,
        banner: { title: e.bell === 'dawn' ? 'Dawn' : e.name, subtitle: `Round ${e.round}`, tone: 'bell' },
      };
    case 'bellsDelayed':
      return {
        kind: 'banner',
        duration: d(TIMING.delay),
        event: e,
        banner: {
          title: e.reason === 'bellTower' ? 'The bells are delayed' : 'The knights are delayed',
          subtitle: `+${e.amount} rounds`,
          tone: 'objective',
        },
      };
    case 'reinforcementsArrived':
      return { kind: 'arrive', duration: d(TIMING.arrive), event: e };
    case 'objectiveCompleted':
      return {
        kind: 'banner',
        duration: d(TIMING.objective),
        event: e,
        banner: { title: 'Objective complete', subtitle: e.name, tone: 'objective' },
      };
    case 'objectiveFailed':
      return {
        kind: 'banner',
        duration: d(TIMING.objective),
        event: e,
        banner: { title: 'Objective failed', subtitle: e.name, tone: 'fail' },
      };
    case 'bridgeBurned':
      return { kind: 'burn', duration: d(TIMING.burn), event: e };
    case 'sealBroken':
      return { kind: 'seal', duration: d(TIMING.seal), event: e };
    case 'duelEnded':
      return { kind: 'pause', duration: d(TIMING.duel), event: e };
    case 'phaseStarted':
      return {
        kind: 'banner',
        duration: d(e.phase === 'player' ? TIMING.phasePlayer : TIMING.phaseAi),
        event: e,
        banner: {
          title: e.faction === 'rebel' ? 'Rebel phase' : 'Loyalist phase',
          subtitle: `Round ${e.round}`,
          tone: 'phase',
        },
      };
    case 'gameOver':
      return { kind: 'pause', duration: d(TIMING.gameOver), event: e };
    case 'dialogue':
      return { kind: 'dialogue', duration: dialogueDuration(e.text), event: e };
  }
}

export function stepsForEvents(events: readonly GameEvent[], speed = 1): AnimStep[] {
  return events.map((e) => stepForEvent(e, speed));
}

/**
 * What the renderer should show instead of the current state while events
 * are still pending. Keys are unit / object / Domain-owner ids.
 */
export interface DisplayOverrides {
  /** Draw the unit at this tile (pending move). */
  pos: Record<string, Pos>;
  /** Show this HP (pending damage/heal). */
  hp: Record<string, number>;
  /** Units not drawn yet (pending reinforcements). */
  hidden: Record<string, true>;
  /** Removed units still drawn (pending death/capture/escape). */
  ghosts: Record<string, Unit>;
  /** Domains not drawn yet (pending activation). */
  hiddenDomains: Record<string, true>;
  /** Destroyed objects still drawn intact (pending destruction). */
  intactObjects: Record<string, true>;
  /** Bridges still drawn intact (pending burn). */
  unburnedBridges: Record<string, Pos[]>;
  /** Gates still drawn closed, keyed by gate id -> the pending wave that opens them. */
  closedGates: Record<string, string>;
}

export function emptyOverrides(): DisplayOverrides {
  return { pos: {}, hp: {}, hidden: {}, ghosts: {}, hiddenDomains: {}, intactObjects: {}, unburnedBridges: {}, closedGates: {} };
}

/**
 * Merges the "before" view of a batch of events into `base`. `prev` is the
 * state the events were produced from; it is only used to look up how a
 * removed unit looked. Earlier pending batches keep their overrides (first
 * writer wins).
 */
export function addPendingOverrides(base: DisplayOverrides, prev: GameState | null, events: readonly GameEvent[]): DisplayOverrides {
  const o: DisplayOverrides = {
    pos: { ...base.pos },
    hp: { ...base.hp },
    hidden: { ...base.hidden },
    ghosts: { ...base.ghosts },
    hiddenDomains: { ...base.hiddenDomains },
    intactObjects: { ...base.intactObjects },
    unburnedBridges: { ...base.unburnedBridges },
    closedGates: { ...base.closedGates },
  };
  const seenPos = new Set<string>(Object.keys(o.pos));
  const seenHp = new Set<string>(Object.keys(o.hp));
  for (const e of events) {
    switch (e.type) {
      case 'moved':
        if (!seenPos.has(e.unitId)) {
          o.pos[e.unitId] = { ...e.from };
          seenPos.add(e.unitId);
        }
        break;
      case 'damaged':
        if (!seenHp.has(e.targetId)) {
          o.hp[e.targetId] = e.hpBefore;
          seenHp.add(e.targetId);
        }
        break;
      case 'healed':
        if (!seenHp.has(e.unitId)) {
          o.hp[e.unitId] = e.hpAfter - e.amount;
          seenHp.add(e.unitId);
        }
        break;
      case 'died':
      case 'captured':
      case 'escaped': {
        if (o.ghosts[e.unitId]) break;
        const before = prev?.units.find((u) => u.id === e.unitId);
        if (before) o.ghosts[e.unitId] = { ...structuredClone(before), pos: { ...e.pos } };
        break;
      }
      case 'reinforcementsArrived':
        for (const u of e.units) o.hidden[u.unitId] = true;
        for (const g of prev?.map.objects ?? []) if (g.kind === 'gate' && g.wave === e.waveId && !g.open) o.closedGates[g.id] = e.waveId;
        break;
      case 'domainActivated':
        o.hiddenDomains[e.unitId] = true;
        break;
      case 'objectDestroyed':
        o.intactObjects[e.objectId] = true;
        break;
      case 'bridgeBurned':
        o.unburnedBridges[e.bridgeId] = e.tiles.map((t) => ({ ...t }));
        break;
      default:
        break;
    }
  }
  return o;
}

/** Updates overrides as a step starts playing. */
export function onStepStart(o: DisplayOverrides, step: AnimStep): void {
  const e = step.event;
  switch (e.type) {
    case 'reinforcementsArrived':
      for (const u of e.units) delete o.hidden[u.unitId];
      for (const [id, wave] of Object.entries(o.closedGates)) if (wave === e.waveId) delete o.closedGates[id];
      break;
    case 'domainActivated':
      delete o.hiddenDomains[e.unitId];
      break;
    case 'damaged':
      o.hp[e.targetId] = e.hpAfter;
      break;
    case 'healed':
      o.hp[e.unitId] = e.hpAfter;
      break;
    case 'objectDestroyed':
      delete o.intactObjects[e.objectId];
      break;
    case 'bridgeBurned':
      delete o.unburnedBridges[e.bridgeId];
      break;
    default:
      break;
  }
}

/** Updates overrides as a step finishes. */
export function onStepEnd(o: DisplayOverrides, step: AnimStep): void {
  const e = step.event;
  switch (e.type) {
    case 'moved':
      delete o.pos[e.unitId];
      break;
    case 'died':
    case 'captured':
    case 'escaped':
      delete o.ghosts[e.unitId];
      delete o.hp[e.unitId];
      break;
    default:
      break;
  }
}

/**
 * A plain FIFO of steps with a clock. The controller feeds it the elapsed
 * time; it reports which steps started and finished so the caller can log
 * events and spawn visual effects.
 */
export class AnimationQueue {
  private steps: AnimStep[] = [];
  private current: AnimStep | null = null;
  private elapsed = 0;

  get busy(): boolean {
    return this.current !== null || this.steps.length > 0;
  }

  get active(): { step: AnimStep; progress: number } | null {
    if (!this.current) return null;
    const p = this.current.duration <= 0 ? 1 : Math.min(1, this.elapsed / this.current.duration);
    return { step: this.current, progress: p };
  }

  get pending(): number {
    return this.steps.length + (this.current ? 1 : 0);
  }

  push(...steps: AnimStep[]): void {
    this.steps.push(...steps);
  }

  clear(): void {
    this.steps = [];
    this.current = null;
    this.elapsed = 0;
  }

  /**
   * Advances the clock by `dt` ms. Several zero-length or short steps may
   * complete in one tick.
   */
  tick(dt: number, onStart: (s: AnimStep) => void, onEnd: (s: AnimStep) => void): void {
    let budget = Math.max(0, dt);
    for (let guard = 0; guard < 10000; guard++) {
      if (!this.current) {
        const next = this.steps.shift();
        if (!next) return;
        this.current = next;
        this.elapsed = 0;
        onStart(next);
      }
      const remaining = this.current.duration - this.elapsed;
      if (budget < remaining) {
        this.elapsed += budget;
        return;
      }
      budget -= Math.max(0, remaining);
      const done = this.current;
      this.current = null;
      this.elapsed = 0;
      onEnd(done);
      if (budget <= 0 && this.steps.length > 0 && (this.steps[0]?.duration ?? 0) > 0) {
        // Start the next one on the following tick so it gets a full frame.
        return;
      }
    }
  }
}
