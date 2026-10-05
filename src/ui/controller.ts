// Wires engine state, input, animation queue, renderer, HUD and cards.
// Input is locked while animations play and during the AI phase; the AI
// phase runs automatically, one action at a time, each animated.
import {
  applyAction,
  createGame,
  pathTo,
  unitAt,
  type Action,
  type BellId,
  type GameEvent,
  type GameState,
  type Pos,
  type ScenarioDef,
} from '../engine';
import { aiActionCap, decideAiAction, type AiChooser } from './aiDriver';
import {
  AnimationQueue,
  addPendingOverrides,
  emptyOverrides,
  onStepEnd,
  onStepStart,
  stepsForEvents,
  type AnimStep,
  type DisplayOverrides,
} from './animation';
import { hideOverlay, showIntro, showResult } from './cards';
import { END_TURN_CONFIRM_MS, decideEndTurn, isArmed } from './endTurnGuard';
import { describeEvent } from './eventText';
import { emperorGuidance, markState, type Guidance } from './guidance';
import { HelpDialog } from './help';
import { Hud } from './hud';
import { bellEra } from './hudModel';
import { resolveFollowUp, type FollowUp } from './interactions';
import type { BoardMark, Era, FxStepContext, Motion } from './gfx/types';
import { SettingsStore, applySpeed } from './settings';
import { computeBoardLayout, placeTooltip } from './layout';
import { makeNameLookup } from './names';
import { Renderer, type Effect } from './renderer';
import type { BannerEmblem, BannerTone } from './gfx/fx';
import {
  NO_SELECTION,
  clickTile,
  cycleSelection,
  intentAt,
  isMoveTile,
  isPlayerTurn,
  readyUnitIds,
  refreshSelection,
  selectNextReadyAfter,
  selectUnit,
  type Selection,
} from './selection';
import { STYLES } from './styles';
import { escapeHtml } from './hud';
import { buildThreatView, overlayAll, overlayFor, type ThreatOverlay, type ThreatView } from './threatView';
import { tooltipFor, type TooltipModel } from './tooltipModel';
import { NO_UNDO, popUndo, recordPlayerAction, reverseMove, undoUnavailableReason, undoableMove, type UndoStack } from './undo';

export interface MountOptions {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  scenario: ScenarioDef;
  chooseAiAction: AiChooser;
  /** Framing text for the intro card. */
  introText?: string;
  /** Skip the intro card (tests / debugging). */
  skipIntro?: boolean;
}

const AI_DELAY_MS = 160;
const AI_SPEED = 0.75;
/** How long a "why nothing happened" notice stays up. */
const NOTICE_MS = 6000;
const NO_MARKS: readonly BoardMark[] = [];

interface GuidanceMemo {
  state: GameState;
  selectedId: string | null;
  g: Guidance | null;
  /** The crown marker by state, so the renderer gets a stable array. */
  marks: Record<BoardMark['state'], readonly BoardMark[]>;
}
const DEFAULT_INTRO =
  'Midnight. The lanterns of Calderon go dark one by one. The Ashen Wolves hold the inner gates. The Emperor must fall before dawn.';

// The Third Bell keeps the Second Bell's lighting (no era of its own yet).
const ERA_BY_BELL: Record<BellId, Era> = { firstBell: 'First Bell', secondBell: 'Second Bell', thirdBell: 'Second Bell', dawn: 'Dawn' };

const BANNER_COLORS = {
  bell: '#e8c872',
  objective: '#9fe0a8',
  fail: '#f39a8a',
  info: '#e8e2d0',
  rebel: '#a9cff2',
  loyalist: '#e8c872',
} as const;

export class GameController {
  private state: GameState;
  private selection: Selection = NO_SELECTION;
  private readonly queue = new AnimationQueue();
  private overrides: DisplayOverrides = emptyOverrides();
  private effects: Effect[] = [];
  private hover: Pos | null = null;
  private started = false;
  private aiActions = 0;
  private aiTimer: number | null = null;
  private generation = 0;
  private resultShown = false;
  private lastFrame = 0;
  private hudDirty = true;
  private dialogueTimer: number | null = null;
  private lastPointer: string = 'mouse';
  private dprWatched = 0;
  /** Touch: the target tile whose forecast is showing (second tap attacks). */
  private touchPreview: Pos | null = null;
  /** Moves that can be taken back (U / Ctrl+Z); emptied by any other player action and at end of turn. */
  private undo: UndoStack = NO_UNDO;
  /** The interaction to perform when the walk-up move being animated has finished. */
  private followUp: FollowUp | null = null;
  /** Enemy reach overlay (T). */
  private threatOn = false;
  private threatMemo: { state: GameState; view: ThreatView; all: ThreatOverlay | null; one: ThreatOverlay | null } | null = null;
  /** When End Turn was first pressed with units still able to act (null = not armed). */
  private endTurnArmedAt: number | null = null;
  private noticeTimer: number | null = null;
  /** Live line and crown marker for the required objective, recomputed when the state or selection changes. */
  private guidanceMemo: GuidanceMemo | null = null;
  /** Steps that must not be logged (the walk back of an undo). */
  private readonly silentSteps = new WeakSet<AnimStep>();
  /** Speed and reduced-motion settings (persisted). */
  private readonly settings = SettingsStore.fromWindow();
  private motion: Motion = this.settings.motion;
  /** The era the board shows: lags the state until the bell step plays (spec 3.4). */
  private displayEra: Era;
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  private readonly tooltip: HTMLDivElement;
  private readonly dialogue: HTMLDivElement;
  private readonly boardInner: HTMLElement;
  private readonly help: HelpDialog;

  constructor(private readonly opts: MountOptions) {
    injectStyles();
    this.state = createGame(opts.scenario);
    this.displayEra = bellEra(this.state);
    this.renderer = new Renderer(opts.canvas);
    this.boardInner = ensureBoardInner(opts.canvas);
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'tooltip';
    this.dialogue = document.createElement('div');
    this.dialogue.id = 'dialogue';
    this.dialogue.addEventListener('click', () => this.hideDialogue());
    this.boardInner.append(this.tooltip, this.dialogue);
    this.hud = new Hud(opts.hud, ensureTileInfo(this.boardInner), {
      onEndTurn: () => this.endTurn(),
      onCommand: (key) => this.command(key),
      onDeselect: () => this.setSelection(NO_SELECTION),
      onNextUnit: () => this.cycle(1),
      onSpeed: () => this.cycleSpeed(),
      onUndo: () => this.undoMove(),
      onThreat: () => this.toggleThreat(),
      onHelp: () => this.help.toggle(),
    });
    this.help = new HelpDialog(() => this.state, this.settings);
    this.settings.subscribe((m) => {
      this.motion = m;
      this.hudDirty = true;
    });
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      // No dt spike when the tab comes back.
      if (!document.hidden) this.lastFrame = 0;
    });
    requestAnimationFrame((t) => this.frame(t));
    if (opts.skipIntro) this.begin();
    else showIntro({ state: this.state, framing: opts.introText ?? DEFAULT_INTRO, onBegin: () => this.begin() });
    this.exposeDebugHook();
  }

  // --- lifecycle ---------------------------------------------------------------

  private begin(): void {
    this.started = true;
    this.hudDirty = true;
    this.hud.appendLog([{ text: `Round ${this.state.round}: Midnight. The coup begins.`, tone: 'phase' }]);
    this.spawnBanner('Midnight', `Round ${this.state.round} · Rebel phase`, BANNER_COLORS.rebel, 1300, 'phase', 'rebel');
    this.hudDirty = true;
  }

  restart(): void {
    this.generation++;
    if (this.aiTimer !== null) window.clearTimeout(this.aiTimer);
    this.aiTimer = null;
    this.state = createGame(this.opts.scenario);
    this.displayEra = bellEra(this.state);
    this.renderer.restart();
    this.selection = NO_SELECTION;
    this.queue.clear();
    this.overrides = emptyOverrides();
    this.effects = [];
    this.aiActions = 0;
    this.resultShown = false;
    this.undo = NO_UNDO;
    this.followUp = null;
    this.endTurnArmedAt = null;
    this.touchPreview = null;
    this.threatMemo = null;
    this.guidanceMemo = null;
    this.setNotice(null);
    this.help.close();
    this.hideDialogue();
    this.hud.clearLog();
    hideOverlay();
    this.begin();
  }

  get locked(): boolean {
    return !this.started || this.queue.busy || this.aiTimer !== null || !isPlayerTurn(this.state);
  }

  // --- applying actions ------------------------------------------------------------

  /**
   * Applies an action; `speed` is the AI pacing factor, the speed setting is applied on top (6.4).
   * Returns the events it produced, or null if the engine rejected it.
   */
  private apply(action: Action, speed = 1): GameEvent[] | null {
    let result;
    try {
      result = applyAction(this.state, action);
    } catch (e) {
      console.error('[ui] action rejected by the engine', action, e);
      return null;
    }
    const prev = this.state;
    this.state = result.state;
    this.overrides = addPendingOverrides(this.overrides, prev, result.events);
    this.queue.push(...applySpeed(stepsForEvents(result.events, speed), this.motion.speed));
    this.hudDirty = true;
    if (!this.queue.busy) window.setTimeout(() => this.onQueueDrained(), 0);
    return result.events;
  }

  /** A player action. `followUp` is an interaction to perform once this move has finished walking. */
  private playerAction(action: Action, followUp: FollowUp | null = null): void {
    if (this.locked) return;
    this.hideTooltip();
    this.setNotice(null);
    this.endTurnArmedAt = null;
    const before = this.state;
    const events = this.apply(action);
    if (!events) return;
    this.undo = recordPlayerAction(this.undo, before, this.state, action, events);
    this.followUp = followUp;
  }

  private endTurn(): void {
    if (this.locked) return;
    const d = decideEndTurn({
      readyCount: readyUnitIds(this.state).length,
      enabled: this.settings.settings.confirmEndTurn,
      armedAt: this.endTurnArmedAt,
      now: performance.now(),
    });
    this.endTurnArmedAt = d.armedAt;
    if (!d.proceed) {
      // The warning is the notice; it and the armed button expire together.
      this.setNotice(d.message, END_TURN_CONFIRM_MS);
      return;
    }
    this.setNotice(null);
    this.undo = NO_UNDO;
    this.followUp = null;
    this.selection = NO_SELECTION;
    this.aiActions = 0;
    this.apply({ kind: 'endTurn' });
  }

  /** Takes back the last move (U / Ctrl+Z): the unit walks back and the state before the move returns. */
  private undoMove(): void {
    if (this.locked) return;
    const entry = undoableMove(this.state, this.undo);
    if (!entry) {
      this.setNotice(undoUnavailableReason(this.state, this.undo) ?? 'Nothing to undo.');
      return;
    }
    this.hideTooltip();
    this.setNotice(null);
    this.endTurnArmedAt = null;
    this.undo = popUndo(this.undo);
    const ev = reverseMove(entry);
    const prev = this.state;
    this.state = entry.before;
    this.overrides = addPendingOverrides(this.overrides, prev, [ev]);
    const steps = applySpeed(stepsForEvents([ev]), this.motion.speed);
    for (const s of steps) this.silentSteps.add(s);
    this.queue.push(...steps);
    this.hud.appendLog([{ text: `${makeNameLookup(this.state)(entry.unitId)} steps back: move undone.`, tone: 'info' }]);
    this.selection = selectUnit(this.state, entry.unitId);
    this.hudDirty = true;
    if (!this.queue.busy) window.setTimeout(() => this.onQueueDrained(), 0);
  }

  private toggleThreat(): void {
    this.threatOn = !this.threatOn;
    this.hudDirty = true;
  }

  /** Shows a short message under the turn buttons for `ms` (null clears it). */
  private setNotice(text: string | null, ms = NOTICE_MS): void {
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    this.hud.setNotice(text);
    this.hudDirty = true;
    if (text) {
      this.noticeTimer = window.setTimeout(() => {
        this.noticeTimer = null;
        this.hud.setNotice(null);
        this.hudDirty = true;
      }, ms);
    }
  }

  private command(key: string): void {
    if (this.locked || this.selection.mode !== 'unit') return;
    const c = this.selection.commands.find((x) => x.key === key);
    if (c) this.playerAction(c.action);
  }

  private cycle(dir: 1 | -1): void {
    if (this.locked) return;
    this.setSelection(cycleSelection(this.state, this.selection, dir));
  }

  private setSelection(sel: Selection): void {
    this.selection = sel;
    this.hudDirty = true;
    this.updateTooltip();
  }

  /** Called once the animation queue is empty after a batch of events. */
  private onQueueDrained(): void {
    if (this.queue.busy) return;
    this.overrides = emptyOverrides();
    this.hudDirty = true;
    if (this.state.gameOver) {
      this.selection = NO_SELECTION;
      if (!this.resultShown && this.state.result) {
        this.resultShown = true;
        const result = this.state.result;
        window.setTimeout(() => showResult({ state: this.state, result, onPlayAgain: () => this.restart() }), 500);
      }
      return;
    }
    if (this.state.phase === 'ai') {
      this.followUp = null;
      this.scheduleAi();
      return;
    }
    // A walk-up (move, then interact): the move has finished, perform the interaction the engine now offers.
    const followUp = this.followUp;
    this.followUp = null;
    if (followUp) {
      const action = resolveFollowUp(this.state, followUp);
      if (action) {
        this.selection = refreshSelection(this.state, this.selection);
        this.playerAction(action);
        return;
      }
      this.setNotice('That is no longer possible from there.');
    }
    const prev = this.selection;
    let next = refreshSelection(this.state, prev);
    // The unit has nothing left to do: hand the selection to the next one that does.
    if (prev.mode === 'unit' && next.mode === 'none') next = selectNextReadyAfter(this.state, prev.unitId);
    this.selection = next;
    this.updateTooltip();
  }

  private scheduleAi(): void {
    if (this.aiTimer !== null) return;
    const gen = this.generation;
    this.aiTimer = window.setTimeout(() => {
      this.aiTimer = null;
      if (gen !== this.generation) return;
      this.aiStep();
    }, AI_DELAY_MS);
  }

  private aiStep(): void {
    if (this.state.gameOver || this.state.phase !== 'ai' || this.queue.busy) return;
    const cap = aiActionCap(this.state);
    const d = decideAiAction(this.state, this.opts.chooseAiAction, this.aiActions, cap);
    if (d.forced) {
      if (d.forced.reason === 'cap') console.warn(`[ui] ${d.forced.detail}; forcing endTurn`);
      else console.error(`[ui] AI ${d.forced.reason}: ${d.forced.detail}; forcing endTurn`);
    }
    this.aiActions++;
    if (d.action.kind === 'endTurn') this.aiActions = 0;
    if (this.apply(d.action, AI_SPEED) === null) {
      // The engine rejected it despite validation: end the phase so the game goes on.
      this.apply({ kind: 'endTurn' }, AI_SPEED);
    }
  }

  // --- animation callbacks -------------------------------------------------------

  private cycleSpeed(): void {
    this.settings.cycleSpeed();
  }

  private stepContext(): FxStepContext {
    return { state: this.state, overrides: this.overrides, now: performance.now(), motion: this.motion };
  }

  private onStart(step: AnimStep): void {
    onStepStart(this.overrides, step);
    if (step.event.type === 'bellRang') this.displayEra = ERA_BY_BELL[step.event.bell];
    this.renderer.stepStarted(step, this.stepContext());
    const name = makeNameLookup(this.state);
    const line = this.silentSteps.has(step) ? null : describeEvent(step.event, name);
    if (line) this.hud.appendLog([line]);
    this.spawnEffects(step);
    this.hudDirty = true;
  }

  private onEnd(step: AnimStep): void {
    onStepEnd(this.overrides, step);
    this.renderer.stepEnded(step, this.stepContext());
  }

  /**
   * Controller-side effects of a step: the dialogue card and banners. All
   * board visuals (particles, floats, rings, poses, shake) are scheduled by
   * fx.onStepStart via renderer.stepStarted (spec 6.3).
   */
  private spawnEffects(step: AnimStep): void {
    const e: GameEvent = step.event;
    if (e.type === 'dialogue') this.showDialogue(e.speaker, e.text, step.duration);
    if (!step.banner) return;
    const tone = step.banner.tone;
    const loyalPhase = e.type === 'phaseStarted' && e.faction === 'loyalist';
    const color = tone === 'phase' ? (loyalPhase ? BANNER_COLORS.loyalist : BANNER_COLORS.rebel) : BANNER_COLORS[tone];
    const emblem: BannerEmblem =
      e.type === 'bellRang'
        ? e.bell === 'dawn'
          ? 'dawn'
          : 'bell'
        : tone === 'phase'
          ? loyalPhase
            ? 'loyalist'
            : 'rebel'
          : tone === 'objective' && e.type === 'objectiveCompleted'
            ? 'check'
            : tone === 'fail'
              ? 'cross'
              : 'diamond';
    this.spawnBanner(step.banner.title, step.banner.subtitle, color, step.duration, tone, emblem);
  }

  private spawnBanner(title: string, subtitle: string, color: string, life: number, tone: BannerTone = 'info', emblem: BannerEmblem = 'diamond'): void {
    // One banner at a time: a newer one replaces the old.
    this.effects = this.effects.filter((f) => f.kind !== 'banner');
    this.effects.push({ kind: 'banner', title, subtitle, color, start: performance.now(), life, tone, emblem });
  }

  private showDialogue(speaker: string, text: string, duration: number): void {
    this.dialogue.innerHTML = `<div class="speaker">${escapeHtml(speaker)}</div><div class="text">“${escapeHtml(text)}”</div>`;
    this.dialogue.style.display = 'block';
    if (this.dialogueTimer !== null) window.clearTimeout(this.dialogueTimer);
    this.dialogueTimer = window.setTimeout(() => this.hideDialogue(), Math.max(6000, duration + 3500));
  }

  private hideDialogue(): void {
    this.dialogue.style.display = 'none';
    if (this.dialogueTimer !== null) window.clearTimeout(this.dialogueTimer);
    this.dialogueTimer = null;
  }

  // --- frame loop ---------------------------------------------------------------------

  private frame(t: number): void {
    if (document.hidden) {
      // Nothing is drawn while the tab is hidden (9.6); the next visible frame starts a fresh dt.
      this.lastFrame = 0;
      requestAnimationFrame((tt) => this.frame(tt));
      return;
    }
    const dt = this.lastFrame === 0 ? 16 : Math.min(100, t - this.lastFrame);
    this.lastFrame = t;
    const wasBusy = this.queue.busy;
    this.queue.tick(
      dt,
      (s) => this.onStart(s),
      (s) => this.onEnd(s),
    );
    if (wasBusy && !this.queue.busy) this.onQueueDrained();
    const now = performance.now();
    // Drop expired effects in place (no per-frame allocation).
    let w = 0;
    for (const e of this.effects) if (now - e.start < e.life) this.effects[w++] = e;
    this.effects.length = w;
    const sel = this.selection;
    const showHighlights = !this.locked;
    let hoverPath: Pos[] | null = null;
    if (showHighlights && sel.mode === 'unit' && this.hover && isMoveTile(sel, this.hover)) {
      hoverPath = pathTo(this.state, sel.unitId, this.hover);
    }
    const guide = this.guidance();
    this.renderer.draw({
      state: this.state,
      overrides: this.overrides,
      active: this.queue.active,
      selection: sel,
      showHighlights,
      hover: this.hover,
      hoverPath,
      threat: showHighlights ? this.threatOverlay() : null,
      marks: this.marks(guide, showHighlights),
      effects: this.effects,
      now,
      era: this.displayEra,
      motion: this.motion,
    });
    this.opts.canvas.classList.toggle('locked', this.locked);
    if (this.hudDirty) {
      this.hudDirty = false;
      this.hud.update({
        state: this.state,
        selection: this.selection,
        hover: this.hover,
        locked: this.locked,
        started: this.started,
        speed: this.motion.speed,
        lockReason: this.lockReason(),
        undoReason: undoUnavailableReason(this.state, this.undo),
        threatOn: this.threatOn,
        endTurnArmed: isArmed(this.endTurnArmedAt, now),
        guidance: guide.g,
      });
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }

  /** Why the controls are disabled right now (for button tooltips). */
  private lockReason(): string | null {
    if (!this.locked) return null;
    if (!this.started) return 'Begin the battle first.';
    if (this.state.gameOver) return 'The battle is over.';
    if (!isPlayerTurn(this.state)) return 'The loyalists are moving. You act again when their phase ends.';
    return 'Wait for the animation to finish.';
  }

  /** The required-objective guidance for the current state and selection (memoised). */
  private guidance(): GuidanceMemo {
    const selectedId = this.selection.mode === 'unit' ? this.selection.unitId : null;
    const m = this.guidanceMemo;
    if (m && m.state === this.state && m.selectedId === selectedId) return m;
    const g = emperorGuidance(this.state, selectedId);
    const marks = (state: BoardMark['state']): readonly BoardMark[] =>
      g?.target ? [{ kind: 'crown', pos: { ...g.target }, state, label: 'Confront' }] : NO_MARKS;
    this.guidanceMemo = { state: this.state, selectedId, g, marks: { idle: marks('idle'), reachable: marks('reachable'), ready: marks('ready') } };
    return this.guidanceMemo;
  }

  /** The crown on the Emperor: it only glows while the player can act on it. */
  private marks(guide: GuidanceMemo, interactive: boolean): readonly BoardMark[] {
    return guide.marks[interactive ? markState(guide.g) : 'idle'];
  }

  /** The tint to draw: a hovered enemy's own reach, else the whole enemy reach when T is on. */
  private threatOverlay(): ThreatOverlay | null {
    const hovered = this.hover ? unitAt(this.state, this.hover) : undefined;
    const enemy = hovered && hovered.faction !== this.state.playerFaction ? hovered : undefined;
    // An enemy the selection can attack already has its forecast; leave the board uncluttered.
    const isTarget = enemy && intentAt(this.selection, enemy.pos)?.kind === 'attack';
    const wantOne = enemy && !isTarget;
    if (!this.threatOn && !wantOne) return null;
    let m = this.threatMemo;
    if (!m || m.state !== this.state) {
      m = { state: this.state, view: buildThreatView(this.state), all: null, one: null };
      this.threatMemo = m;
    }
    if (wantOne) {
      if (m.one?.unitId !== enemy.id) m.one = overlayFor(m.view, enemy.id);
      if (m.one) return m.one;
    }
    if (!this.threatOn) return null;
    return (m.all ??= overlayAll(m.view));
  }

  // --- input -------------------------------------------------------------------------

  private resize(): void {
    const root = document.documentElement;
    const vp = { width: root.clientWidth || window.innerWidth, height: root.clientHeight || window.innerHeight };
    const layout = computeBoardLayout(vp, this.state.map.width, this.state.map.height);
    const dpr = window.devicePixelRatio || 1;
    this.renderer.resize(layout.tile, dpr, this.state.map.width, this.state.map.height);
    root.style.setProperty('--fs', `${layout.fontSize}px`);
    root.style.setProperty('--hud-w', `${layout.hudWidth}px`);
    root.style.setProperty('--info-h', `${layout.infoHeight}px`);
    root.style.setProperty('--board-w', `${this.renderer.cssWidth}px`);
    this.watchDpr(dpr);
    this.updateTooltip();
  }

  /** Re-lays out when the device pixel ratio changes (browser zoom, moving to another screen). */
  private watchDpr(dpr: number): void {
    if (this.dprWatched === dpr || typeof window.matchMedia !== 'function') return;
    this.dprWatched = dpr;
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    mq.addEventListener?.('change', () => this.resize(), { once: true });
  }

  private tileFromEvent(ev: MouseEvent): Pos | null {
    const rect = this.opts.canvas.getBoundingClientRect();
    return this.renderer.tileAtClient(ev.clientX - rect.left, ev.clientY - rect.top, this.state.map.width, this.state.map.height);
  }

  private bindInput(): void {
    const c = this.opts.canvas;
    c.addEventListener('pointermove', (ev) => {
      const p = this.tileFromEvent(ev);
      if (!samePos(p, this.hover)) {
        this.hover = p;
        this.hudDirty = true;
        this.updateTooltip();
      }
    });
    c.addEventListener('pointerdown', (ev) => {
      this.lastPointer = ev.pointerType || 'mouse';
    });
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.hudDirty = true;
      this.hideTooltip();
    });
    c.addEventListener('click', (ev) => {
      const p = this.tileFromEvent(ev);
      this.hover = p;
      this.hudDirty = true;
      if (!p || this.locked) {
        this.updateTooltip();
        return;
      }
      const intent = intentAt(this.selection, p, ev.shiftKey);
      if (this.lastPointer === 'touch' && intent && intent.kind !== 'move' && intent.kind !== 'stand' && !samePos(this.touchPreview, p)) {
        // First tap on a target shows what it does; a second tap does it.
        this.touchPreview = p;
        this.updateTooltip();
        return;
      }
      this.touchPreview = null;
      this.setNotice(null);
      const res = clickTile(this.state, this.selection, p, { preferAttack: ev.shiftKey });
      if (res.action) this.playerAction(res.action, res.followUp ?? null);
      else {
        this.setSelection(res.selection);
        if (res.notice) this.setNotice(res.notice);
      }
    });
    window.addEventListener('keydown', (ev) => this.onKey(ev));
  }

  private onKey(ev: KeyboardEvent): void {
    if (!this.started || document.getElementById('overlay')?.style.display === 'flex') return;
    const k = ev.key;
    const plain = !ev.ctrlKey && !ev.metaKey && !ev.altKey;
    if (this.help.isOpen) {
      // The dialog handles Tab and Esc itself; only the help key toggles it from the keyboard.
      if (plain && !ev.repeat && (k === 'h' || k === 'H' || k === '?')) {
        ev.preventDefault();
        this.help.close();
      }
      return;
    }
    if (k === 'Tab') {
      ev.preventDefault();
      this.cycle(ev.shiftKey ? -1 : 1);
    } else if (k === 'Escape') {
      this.setSelection(NO_SELECTION);
      this.hideDialogue();
    } else if (k === 'e' || k === 'E') {
      // A held key repeats: it must not count as the second press of the end-turn safeguard.
      if (!ev.repeat) this.endTurn();
    } else if (k === 'w' || k === 'W') {
      this.command('wait');
    } else if (plain && (k === 's' || k === 'S')) {
      this.cycleSpeed();
    } else if (!ev.repeat && ((plain && (k === 'u' || k === 'U')) || ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && (k === 'z' || k === 'Z')))) {
      ev.preventDefault();
      this.undoMove();
    } else if (plain && !ev.repeat && (k === 't' || k === 'T')) {
      this.toggleThreat();
    } else if (plain && !ev.repeat && (k === 'h' || k === 'H' || k === '?')) {
      ev.preventDefault();
      this.help.open();
    }
  }

  private updateTooltip(): void {
    const sel = this.selection;
    const p = this.hover;
    if (!p || sel.mode !== 'unit' || this.locked) return this.hideTooltip();
    const model = tooltipFor(this.state, sel, intentAt(sel, p), this.lastPointer === 'touch');
    if (!model) return this.hideTooltip();
    this.tooltip.className = model.cls;
    this.tooltip.innerHTML = tooltipHtml(model);
    this.tooltip.style.display = 'block';
    const anchor = this.renderer.tileCenterCss(p);
    const bw = this.boardInner.clientWidth;
    const bh = this.boardInner.clientHeight;
    const pos = placeTooltip(anchor.x, anchor.y, this.tooltip.offsetWidth, this.tooltip.offsetHeight, bw, bh);
    this.tooltip.style.left = `${pos.left}px`;
    this.tooltip.style.top = `${pos.top}px`;
  }

  private hideTooltip(): void {
    this.tooltip.style.display = 'none';
  }

  /** Small read-only hook for the browser smoke test. */
  private exposeDebugHook(): void {
    const self = this;
    (window as unknown as { __lantern?: unknown }).__lantern = {
      get state(): GameState {
        return self.state;
      },
      get locked(): boolean {
        return self.locked;
      },
      get started(): boolean {
        return self.started;
      },
      get selection(): Selection {
        return self.selection;
      },
      /** Moves that Undo can take back. */
      get undoDepth(): number {
        return self.undo.length;
      },
      get threatOn(): boolean {
        return self.threatOn;
      },
      get helpOpen(): boolean {
        return self.help.isOpen;
      },
      /** Page (client) coordinates of a tile's centre. */
      tileToClient(x: number, y: number): { x: number; y: number } {
        const rect = self.opts.canvas.getBoundingClientRect();
        const c = self.renderer.tileCenterCss({ x, y });
        return { x: rect.left + c.x, y: rect.top + c.y };
      },
    };
  }
}

function samePos(a: Pos | null, b: Pos | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}

/** Tooltip markup: the attack forecast keeps its original look; interactions get a description and an amber call to action. */
function tooltipHtml(m: TooltipModel): string {
  const head = `<div><b>${escapeHtml(m.title)}</b>${m.sub ? ` <span class="muted">${escapeHtml(m.sub)}</span>` : ''}</div>`;
  const lines = m.lines.map((l) => `<div class="${l.kind === 'muted' ? 'muted' : l.kind}">${escapeHtml(l.text)}</div>`).join('');
  return head + lines;
}

function injectStyles(): void {
  if (document.getElementById('lantern-styles')) return;
  const el = document.createElement('style');
  el.id = 'lantern-styles';
  el.textContent = STYLES;
  document.head.appendChild(el);
}

function ensureBoardInner(canvas: HTMLCanvasElement): HTMLElement {
  const parent = canvas.parentElement;
  if (parent && parent.id === 'board-inner') return parent;
  const inner = document.createElement('div');
  inner.id = 'board-inner';
  parent?.insertBefore(inner, canvas);
  inner.appendChild(canvas);
  return inner;
}

function ensureTileInfo(boardInner: HTMLElement): HTMLElement {
  const existing = document.getElementById('tileinfo');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'tileinfo';
  boardInner.insertAdjacentElement('afterend', el);
  return el;
}

export function mountGame(opts: MountOptions): GameController {
  return new GameController(opts);
}
