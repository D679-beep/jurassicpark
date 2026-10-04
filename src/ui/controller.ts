// Wires engine state, input, animation queue, renderer, HUD and cards.
// Input is locked while animations play and during the AI phase; the AI
// phase runs automatically, one action at a time, each animated.
import {
  applyAction,
  createGame,
  pathTo,
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
import { describeEvent } from './eventText';
import { Hud } from './hud';
import { bellEra } from './hudModel';
import type { Era, FxStepContext, Motion } from './gfx/types';
import { SettingsStore, applySpeed } from './settings';
import { computeBoardLayout, placeTooltip } from './layout';
import { makeNameLookup } from './names';
import { Renderer, type Effect } from './renderer';
import type { BannerEmblem, BannerTone } from './gfx/fx';
import {
  NO_SELECTION,
  attackForecast,
  clickTile,
  cycleSelection,
  forecastText,
  isMoveTile,
  isPlayerTurn,
  refreshSelection,
  targetAt,
  type Selection,
} from './selection';
import { STYLES } from './styles';
import { escapeHtml } from './hud';

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
const DEFAULT_INTRO =
  'Midnight. The lanterns of Calderon go dark one by one. The Ashen Wolves hold the inner gates. The Emperor must fall before dawn.';

const ERA_BY_BELL: Record<BellId, Era> = { firstBell: 'First Bell', secondBell: 'Second Bell', dawn: 'Dawn' };

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
    });
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
    this.hideDialogue();
    this.hud.clearLog();
    hideOverlay();
    this.begin();
  }

  get locked(): boolean {
    return !this.started || this.queue.busy || this.aiTimer !== null || !isPlayerTurn(this.state);
  }

  // --- applying actions ------------------------------------------------------------

  /** Applies an action; `speed` is the AI pacing factor, the speed setting is applied on top (6.4). */
  private apply(action: Action, speed = 1): boolean {
    let result;
    try {
      result = applyAction(this.state, action);
    } catch (e) {
      console.error('[ui] action rejected by the engine', action, e);
      return false;
    }
    const prev = this.state;
    this.state = result.state;
    this.overrides = addPendingOverrides(this.overrides, prev, result.events);
    this.queue.push(...applySpeed(stepsForEvents(result.events, speed), this.motion.speed));
    this.hudDirty = true;
    if (!this.queue.busy) window.setTimeout(() => this.onQueueDrained(), 0);
    return true;
  }

  private playerAction(action: Action): void {
    if (this.locked) return;
    this.hideTooltip();
    this.apply(action);
  }

  private endTurn(): void {
    if (this.locked) return;
    this.selection = NO_SELECTION;
    this.aiActions = 0;
    this.apply({ kind: 'endTurn' });
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
      this.scheduleAi();
      return;
    }
    this.selection = refreshSelection(this.state, this.selection);
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
    if (!this.apply(d.action, AI_SPEED)) {
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
    const line = describeEvent(step.event, name);
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
    this.renderer.draw({
      state: this.state,
      overrides: this.overrides,
      active: this.queue.active,
      selection: sel,
      showHighlights,
      hover: this.hover,
      hoverPath,
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
      });
    }
    requestAnimationFrame((tt) => this.frame(tt));
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
      if (this.lastPointer === 'touch' && targetAt(this.selection, p) && !samePos(this.touchPreview, p)) {
        // First tap on a target shows the damage forecast; a second tap attacks.
        this.touchPreview = p;
        this.updateTooltip();
        return;
      }
      this.touchPreview = null;
      const res = clickTile(this.state, this.selection, p);
      if (res.action) this.playerAction(res.action);
      else this.setSelection(res.selection);
    });
    window.addEventListener('keydown', (ev) => {
      if (!this.started || document.getElementById('overlay')?.style.display === 'flex') return;
      const k = ev.key;
      if (k === 'Tab') {
        ev.preventDefault();
        this.cycle(ev.shiftKey ? -1 : 1);
      } else if (k === 'Escape') {
        this.setSelection(NO_SELECTION);
        this.hideDialogue();
      } else if (k === 'e' || k === 'E') {
        this.endTurn();
      } else if (k === 'w' || k === 'W') {
        this.command('wait');
      } else if ((k === 's' || k === 'S') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        this.cycleSpeed();
      }
    });
  }

  private updateTooltip(): void {
    const sel = this.selection;
    const p = this.hover;
    if (!p || sel.mode !== 'unit' || this.locked) return this.hideTooltip();
    const target = targetAt(sel, p);
    if (!target) return this.hideTooltip();
    const f = attackForecast(this.state, sel.unitId, target.id);
    if (!f) return this.hideTooltip();
    const name = makeNameLookup(this.state)(target.id);
    this.tooltip.innerHTML =
      `<div><b>${escapeHtml(name)}</b> <span class="muted">HP ${f.targetHp}</span></div>` +
      `<div class="dmg">${escapeHtml(forecastText(f))}</div>` +
      `<div class="muted">${this.lastPointer === 'touch' ? 'Tap again to attack' : 'Click to attack'}</div>`;
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
