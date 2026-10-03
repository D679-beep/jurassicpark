import { describe, expect, it } from 'vitest';
import {
  AnimationQueue,
  TIMING,
  addPendingOverrides,
  emptyOverrides,
  onStepEnd,
  onStepStart,
  stepForEvent,
  stepsForEvents,
  type AnimStep,
} from '../../src/ui/animation';
import { END, play, uiGame } from './fixture';

describe('steps from events', () => {
  it('gives every event one step, moves scale with path length', () => {
    const s = uiGame();
    const { events } = play(s, { kind: 'move', unitId: 'varek', to: { x: 3, y: 2 } });
    const steps = stepsForEvents(events);
    expect(steps).toHaveLength(events.length);
    expect(steps[0]!.kind).toBe('move');
    expect(steps[0]!.duration).toBe(TIMING.moveStep);
    expect(stepsForEvents(events, 0.5)[0]!.duration).toBe(Math.round(TIMING.moveStep * 0.5));
  });

  it('turns bells and phases into banners', () => {
    const { events } = play(uiGame(), END, END, END, END);
    const banners = stepsForEvents(events).filter((s) => s.kind === 'banner').map((s) => s.banner!.title);
    expect(banners).toContain('Loyalist phase');
    expect(banners).toContain('Rebel phase');
    expect(banners).toContain('First Bell');
    expect(stepsForEvents(events).some((s) => s.kind === 'arrive')).toBe(true);
  });

  it('holds dialogue long enough to read', () => {
    const short = stepForEvent({ type: 'dialogue', trigger: 'confront', speakerId: null, speaker: 'X', text: 'Hi.' });
    const long = stepForEvent({ type: 'dialogue', trigger: 'confront', speakerId: null, speaker: 'X', text: 'x'.repeat(500) });
    expect(short.duration).toBeGreaterThanOrEqual(TIMING.dialogueMin);
    expect(short.duration).toBeLessThan(1500);
    expect(long.duration).toBe(TIMING.dialogueMax);
  });
});

describe('display overrides', () => {
  it('shows a moving unit at its old tile until the move has played', () => {
    const s = uiGame();
    const { events } = play(s, { kind: 'move', unitId: 'varek', to: { x: 3, y: 2 } });
    const o = addPendingOverrides(emptyOverrides(), s, events);
    expect(o.pos.varek).toEqual({ x: 3, y: 3 });
    const step = stepsForEvents(events)[0]!;
    onStepStart(o, step);
    expect(o.pos.varek).toEqual({ x: 3, y: 3 });
    onStepEnd(o, step);
    expect(o.pos.varek).toBeUndefined();
  });

  it('keeps a killed unit as a ghost with its old HP until its death plays', () => {
    const s = uiGame();
    const { events } = play(s, { kind: 'attack', unitId: 'wolf', targetId: 'guard' });
    const o = addPendingOverrides(emptyOverrides(), s, events);
    expect(o.hp.guard).toBe(3);
    expect(o.ghosts.guard?.name).toBe('Palace Guard');
    const [hit, death] = stepsForEvents(events) as [AnimStep, AnimStep];
    onStepStart(o, hit);
    expect(o.hp.guard).toBe(0);
    onStepEnd(o, hit);
    onStepStart(o, death);
    expect(o.ghosts.guard).toBeDefined();
    onStepEnd(o, death);
    expect(o.ghosts.guard).toBeUndefined();
    expect(o.hp.guard).toBeUndefined();
  });

  it('hides reinforcements until they arrive', () => {
    const prev = play(uiGame(), END).state;
    const { events } = play(prev, END);
    const o = addPendingOverrides(emptyOverrides(), prev, events);
    expect(o.hidden['watch-1']).toBe(true);
    expect(o.hidden['watch-2']).toBe(true);
    const arrive = stepsForEvents(events).find((s) => s.kind === 'arrive')!;
    onStepStart(o, arrive);
    expect(o.hidden['watch-1']).toBeUndefined();
  });

  it('hides a new Domain and keeps a burned bridge intact until their steps', () => {
    const s = uiGame();
    const { events } = play(
      s,
      { kind: 'domain', unitId: 'varek' },
      { kind: 'interact', unitId: 'archer', interaction: 'burnBridge', targetId: 'bridgeMid' },
    );
    const o = addPendingOverrides(emptyOverrides(), s, events);
    expect(o.hiddenDomains.varek).toBe(true);
    expect(o.unburnedBridges.bridgeMid).toEqual([{ x: 3, y: 4 }]);
    for (const st of stepsForEvents(events)) onStepStart(o, st);
    expect(o.hiddenDomains.varek).toBeUndefined();
    expect(o.unburnedBridges.bridgeMid).toBeUndefined();
  });

  it('lets an earlier pending batch win', () => {
    const base = addPendingOverrides(emptyOverrides(), null, [
      { type: 'moved', unitId: 'a', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, path: [{ x: 1, y: 0 }] },
    ]);
    const merged = addPendingOverrides(base, null, [
      { type: 'moved', unitId: 'a', from: { x: 1, y: 0 }, to: { x: 2, y: 0 }, path: [{ x: 2, y: 0 }] },
    ]);
    expect(merged.pos.a).toEqual({ x: 0, y: 0 });
    expect(base).not.toBe(merged);
  });
});

describe('AnimationQueue', () => {
  const step = (duration: number, id: string): AnimStep => ({
    kind: 'pause',
    duration,
    event: { type: 'moved', unitId: id, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, path: [] },
  });

  it('plays steps in order, reporting start and end', () => {
    const q = new AnimationQueue();
    const log: string[] = [];
    const id = (s: AnimStep): string => (s.event.type === 'moved' ? s.event.unitId : '?');
    q.push(step(100, 'a'), step(50, 'b'));
    expect(q.busy).toBe(true);
    const tick = (dt: number): void =>
      q.tick(
        dt,
        (s) => log.push(`start ${id(s)}`),
        (s) => log.push(`end ${id(s)}`),
      );
    tick(60);
    expect(log).toEqual(['start a']);
    expect(q.active?.progress).toBeCloseTo(0.6);
    tick(60);
    expect(log).toEqual(['start a', 'end a', 'start b']);
    tick(100);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
    expect(q.busy).toBe(false);
    expect(q.active).toBeNull();
  });

  it('runs zero-length steps immediately and can be cleared', () => {
    const q = new AnimationQueue();
    let ends = 0;
    q.push(step(0, 'a'), step(0, 'b'), step(0, 'c'));
    q.tick(0, () => undefined, () => ends++);
    expect(ends).toBe(3);
    q.push(step(100, 'd'));
    q.clear();
    expect(q.busy).toBe(false);
  });
});
