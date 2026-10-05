// DOM HUD inside #hud: clock and bells, turn controls, selected unit with
// command buttons, objectives, event log (scrolls inside its panel) and a
// collapsible legend. The hovered-tile strip lives under the board.
import { domainUnavailableReason, findUnit, type GameState } from '../engine';
import { ChronicleLog, factionName, type LogLine } from './eventText';
import type { Guidance } from './guidance';
import { bellEra, bellTrack, nextBellText, nextWaveText, objectiveRows, speakerLook, tileInfo, unitGlyph, unitSummary, type TileInfo, type UnitSummary } from './hudModel';
import { icon, medallion, objectiveIcon, rankIcon, tokenIcon, type IconName } from './icons';
import type { Pos, Unit } from '../engine';
import { hpColor } from './palette';
import type { Selection } from './selection';
import { speedLabel, type Speed } from './settings';

export interface HudCallbacks {
  onEndTurn(): void;
  onCommand(key: string): void;
  onDeselect(): void;
  onNextUnit(): void;
  /** Cycle the animation speed (1x -> 2x -> instant). */
  onSpeed(): void;
  /** Take back the last move. */
  onUndo(): void;
  /** Show or hide the enemy threat overlay. */
  onThreat(): void;
  /** Open the help dialog. */
  onHelp(): void;
}

export interface HudView {
  state: GameState;
  selection: Selection;
  hover: Pos | null;
  /** Input is locked (animating or AI phase). */
  locked: boolean;
  /** The intro card has been dismissed. */
  started: boolean;
  /** Animation speed setting (shown on the speed button). */
  speed: Speed;
  /** Why the controls are locked, for the tooltip of a disabled button (null when they are not). */
  lockReason: string | null;
  /** Undo: null when a move can be taken back, else the reason it cannot. */
  undoReason: string | null;
  /** The enemy reach overlay is on. */
  threatOn: boolean;
  /** End Turn was pressed once while units could still act: the next press ends the turn. */
  endTurnArmed: boolean;
  /** The live line for the required objective (null when the scenario has none). */
  guidance: Guidance | null;
}

const MAX_LOG = 300;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export class Hud {
  private readonly sections: Record<'clock' | 'unit' | 'objectives', HTMLElement>;
  private readonly log: HTMLUListElement;
  private readonly noticeEl: HTMLDivElement;
  private readonly chronicle = new ChronicleLog();
  private readonly logItems = new WeakMap<LogLine, HTMLLIElement>();
  private readonly cache = new Map<HTMLElement, string>();
  /** The chronicle follows new lines unless the player scrolled up to read. */
  private followLog = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly tileEl: HTMLElement,
    private readonly cb: HudCallbacks,
  ) {
    root.innerHTML = '';
    const mk = (cls: string, title?: string): HTMLElement => {
      const el = document.createElement('section');
      el.className = `panel ${cls}`;
      if (title) {
        const h = document.createElement('h2');
        h.textContent = title;
        el.appendChild(h);
      }
      const body = document.createElement('div');
      el.appendChild(body);
      root.appendChild(el);
      return body;
    };
    this.sections = {
      clock: mk('clock-panel turn-panel'),
      unit: mk('unit-panel', 'Selected'),
      objectives: mk('objectives-panel', 'Objectives'),
    };
    // Short messages ("why nothing happened", the end-turn warning) live outside the
    // cached clock markup so the live region survives re-renders.
    this.noticeEl = document.createElement('div');
    this.noticeEl.className = 'notice';
    this.noticeEl.setAttribute('role', 'status');
    this.sections.clock.parentElement?.appendChild(this.noticeEl);
    const logBody = mk('log-panel', 'Chronicle');
    this.log = document.createElement('ul');
    this.log.id = 'log';
    logBody.appendChild(this.log);
    this.log.addEventListener('scroll', () => {
      this.followLog = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 30;
    });
    // The panel resizes as the selected-unit panel above it grows and shrinks:
    // stay pinned to the newest line.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        if (this.followLog) this.log.scrollTop = this.log.scrollHeight;
      }).observe(this.log);
    }
    const legend = document.createElement('details');
    legend.className = 'panel legend-panel';
    // Open by default when the window is tall enough to spare the room.
    legend.open = window.innerHeight >= 860;
    root.appendChild(legend);
    legend.innerHTML = legendHtml();

    const onClick = (ev: MouseEvent): void => {
      const t = (ev.target as HTMLElement | null)?.closest('button');
      if (!t || t.disabled) return;
      const cmd = t.getAttribute('data-cmd');
      if (cmd === 'endTurn') this.cb.onEndTurn();
      else if (cmd === 'deselect') this.cb.onDeselect();
      else if (cmd === 'next') this.cb.onNextUnit();
      else if (cmd === 'speed') this.cb.onSpeed();
      else if (cmd === 'undo') this.cb.onUndo();
      else if (cmd === 'threat') this.cb.onThreat();
      else if (cmd === 'help') this.cb.onHelp();
      else if (cmd) this.cb.onCommand(cmd);
    };
    root.addEventListener('click', onClick);
    watchDialogue();
  }

  private set(el: HTMLElement, html: string): void {
    if (this.cache.get(el) === html) return;
    this.cache.set(el, html);
    el.innerHTML = html;
  }

  update(v: HudView): void {
    const s = v.state;
    const phaseCls = s.activeFaction;
    const phaseText = s.gameOver ? 'Battle over' : `${factionName(s.activeFaction)} phase`;
    const wave = nextWaveText(s);
    const playerTurn = !s.gameOver && s.phase === 'player' && s.activeFaction === s.playerFaction;
    const status = !v.started
      ? 'Waiting to begin.'
      : s.gameOver
        ? 'The battle is decided.'
        : !playerTurn
          ? 'The loyalists are moving…'
          : v.locked
            ? 'Resolving…'
            : 'Your turn: click a rebel unit.';
    const lockedNow = !playerTurn || v.locked;
    const off = lockedNow ? 'disabled' : '';
    const why = lockedNow && v.lockReason ? escapeHtml(v.lockReason) : '';
    const tip = (enabledTitle: string): string => ` title="${why || escapeHtml(enabledTitle)}"`;
    const undoOff = lockedNow || v.undoReason !== null;
    const undoTitle = escapeHtml(v.undoReason ?? (why || 'Take back the last move (U or Ctrl+Z)'));
    const track = bellTrack(s);
    this.set(
      this.sections.clock,
      // Title row with the speed control (7.3), then the clock with the bell track.
      `<div class="titlebar"><p class="title">${escapeHtml(s.scenarioName)}</p>` +
        `<button class="speed" data-cmd="speed" aria-label="Animation speed" title="Animation speed (S)">` +
        `${icon('speed')}<span>${escapeHtml(speedLabel(v.speed))}</span></button></div>` +
        `<div class="clock"><span>Round <b>${s.round}</b></span><span class="era">${bellEra(s)}</span>` +
        `<span class="bells" role="img" aria-label="Bells rung: ${track.filter((b) => b.rung).length} of ${track.length}">${track
          .map((b) => `<span class="${b.rung ? 'rung' : 'pending'}" title="${escapeHtml(b.name)}, round ${b.round}${b.rung ? ' (rung)' : ''}">${icon(b.rung ? 'bell' : 'bellOff')}</span>`)
          .join('')}</span>` +
        `<span class="phase-pill ${phaseCls}">${phaseText}</span></div>` +
        `<div class="turn-info small">${icon('bell')}Next: ${escapeHtml(nextBellText(s))}` +
        (wave ? `<br><span class="muted">${icon('banner')}Reinforcements: ${escapeHtml(wave)}</span>` : '') +
        `</div><div class="status${playerTurn && !v.locked && v.started ? ' yours' : ''}">${status}</div><div class="buttons">` +
        `<button data-cmd="next" ${off}${tip('Select the next unit that can still act (Tab)')}>Next unit<kbd>Tab</kbd></button>` +
        `<button class="primary${v.endTurnArmed ? ' armed' : ''}" data-cmd="endTurn" ${off}${tip('End your turn (E)')}>` +
        `${v.endTurnArmed ? 'Press again' : 'End Turn'}<kbd>E</kbd></button>` +
        `</div><div class="tools">` +
        `<button data-cmd="undo" aria-keyshortcuts="U Control+Z" ${undoOff ? 'disabled' : ''} title="${undoTitle}">Undo<kbd>U</kbd></button>` +
        `<button data-cmd="threat" aria-pressed="${v.threatOn}" aria-keyshortcuts="T" title="Show or hide the tiles the loyalists can attack next turn (T)">${icon('target')}Threat<kbd>T</kbd></button>` +
        `<button data-cmd="help" aria-keyshortcuts="H ?" title="How to play (H or ?)">Help<kbd>H</kbd></button>` +
        `</div>`,
    );

    this.set(this.sections.unit, this.unitHtml(v));
    this.set(this.tileEl, this.tileHtml(v));

    const rows = objectiveRows(s);
    const g = v.guidance;
    const guide = g
      ? `<div class="guide tone-${g.tone}${g.kind === 'ready' ? ' ready' : ''}" role="status"><span class="guide-ic">${icon('crown')}</span><span>${escapeHtml(g.text)}</span></div>`
      : '';
    this.set(
      this.sections.objectives,
      rows.length === 0
        ? '<div class="muted small">No objectives.</div>'
        : `<ul class="objectives">${rows
            .map(
              (r) =>
                `<li class="${r.status}" title="${escapeHtml(r.hint)}"><span class="icon" aria-label="${r.status}">${objectiveIcon(r.id, r.status)}</span>` +
                `<span class="name">${escapeHtml(r.name)}</span><span class="type ${r.type}">${r.type}</span></li>`,
            )
            .join('')}</ul>${guide}`,
    );
  }

  /** Shows a short message under the turn buttons (null clears it). */
  setNotice(text: string | null): void {
    if (this.noticeEl.textContent !== (text ?? '')) this.noticeEl.textContent = text ?? '';
  }

  private unitHtml(v: HudView): string {
    const s = v.state;
    if (v.selection.mode !== 'unit') {
      return '<div class="muted small">No unit selected. Click a ready rebel, or press Tab.</div>';
    }
    const u = findUnit(s, v.selection.unitId);
    if (!u) return '<div class="muted small">No unit selected.</div>';
    const sum = unitSummary(s, u);
    const disabled = v.locked ? 'disabled' : '';
    const sel = v.selection;
    const buttons = sel.commands
      .map((c) => {
        const cls = c.kind === 'domain' ? 'domain' : c.kind === 'interact' ? 'interact' : '';
        const key = c.kind === 'wait' ? '<kbd>W</kbd>' : '';
        const ic = c.kind === 'domain' ? icon('domain') : '';
        const hint = c.kind === 'interact' ? sel.interactions.find((t) => t.key === c.key)?.hint : undefined;
        const title = hint ? ` title="${escapeHtml(hint)}"` : '';
        return `<button class="${cls}" data-cmd="${escapeHtml(c.key)}" ${disabled}${title}>${ic}${escapeHtml(c.label)}${key}</button>`;
      })
      .join('');
    // Say why the Domain is not on offer instead of silently dropping the button (a spent Domain is already in the summary).
    const domainWhy =
      u.rank === 'ascendant' && !u.domainUsed && !sel.commands.some((c) => c.kind === 'domain') ? domainUnavailableReason(v.state, u) : null;
    const onMap = sel.interactions.some((t) => t.kind === 'unit') || sel.approaches.length > 0;
    return (
      summaryHtml(sum, unitGlyph(u), u.rank === 'ascendant') +
      (domainWhy ? `<div class="small muted why">Domain unavailable: ${escapeHtml(domainWhy)}.</div>` : '') +
      (onMap ? '<div class="small muted why">You can also click the amber target on the map.</div>' : '') +
      `<div class="buttons">${buttons}<button data-cmd="deselect" ${disabled}>Deselect<kbd>Esc</kbd></button></div>`
    );
  }

  private tileHtml(v: HudView): string {
    if (!v.hover) return '<div class="muted">Hover a tile for terrain, zone and unit details.</div>';
    const info: TileInfo | null = tileInfo(v.state, v.hover);
    if (!info) return '<div class="muted">Outside the map.</div>';
    const parts: string[] = [
      `<b>${escapeHtml(info.terrain)}</b> <span class="muted">(${info.pos.x},${info.pos.y})</span>`,
      `<span class="muted">Move ${escapeHtml(info.moveCost)} · Def +${info.defense}</span>`,
    ];
    if (info.zones.length) parts.push(`<span class="zone">${escapeHtml(info.zones.join(', '))}</span>`);
    for (const f of info.features) parts.push(`<span>${escapeHtml(f)}</span>`);
    let unitLine = '';
    const u = info.unit;
    if (u) {
      const extra = [...u.statuses, ...u.notes.filter((n) => !n.startsWith('Non-Ascendants'))];
      unitLine =
        `<div class="ti-unit"><span class="dot ${u.faction}"></span><b>${escapeHtml(u.name)}</b>` +
        `<span class="muted">${factionName(u.faction)} ${escapeHtml(u.rank)}</span>` +
        stat('heart', 'HP', `<b>${u.hp}/${u.maxHp}</b>`) +
        stat('sword', 'ATK', String(u.atk)) +
        stat('shield', 'DEF', String(u.def)) +
        stat('boot', 'MOV', String(u.move)) +
        stat('target', 'RNG', escapeHtml(u.range)) +
        (extra.length ? `<span class="muted">${escapeHtml(extra.join(' · '))}</span>` : '') +
        `</div>`;
    }
    return `<div class="ti-tile">${parts.join('<span class="sep">|</span>')}</div>${unitLine}`;
  }

  appendLog(lines: readonly LogLine[]): void {
    if (lines.length === 0) return;
    const atBottom = this.followLog;
    for (const l of lines) {
      const { entry, isNew } = this.chronicle.push(l);
      if (!isNew) {
        // A repositioning summary already in the log: update it in place.
        const existing = this.logItems.get(entry);
        if (existing?.isConnected) {
          existing.textContent = entry.text;
          continue;
        }
      }
      const li = document.createElement('li');
      li.className = entry.tone;
      li.textContent = entry.text;
      this.logItems.set(entry, li);
      this.log.appendChild(li);
    }
    while (this.log.childElementCount > MAX_LOG) this.log.firstElementChild?.remove();
    if (atBottom) {
      this.log.scrollTop = this.log.scrollHeight;
      this.followLog = true;
    }
  }

  clearLog(): void {
    this.log.innerHTML = '';
    this.chronicle.reset();
    this.followLog = true;
  }
}

function summaryHtml(sum: UnitSummary, glyph: string, asc: boolean): string {
  const ratio = sum.maxHp > 0 ? sum.hp / sum.maxHp : 0;
  const tags = [
    ...sum.statuses.map((x) => {
      const ic = STATUS_ICON[x];
      return `<span class="tag status s-${x.toLowerCase()}">${ic ? icon(ic) : ''}${escapeHtml(x)}</span>`;
    }),
    ...sum.notes.map((x) => `<span class="tag">${escapeHtml(x)}</span>`),
  ].join('');
  const vals = [`${sum.hp}/${sum.maxHp}`, String(sum.atk), String(sum.def), String(sum.move), sum.range];
  const stats = STAT_CELLS.map(
    ([ic, short, long], i) => `<span title="${long}"><span class="lab">${icon(ic)}${short}</span><b>${escapeHtml(vals[i]!)}</b></span>`,
  ).join('');
  return (
    `<div class="unit-head"><span class="token ${sum.faction}${asc ? ' asc' : ''}">${tokenSvg(sum.faction, glyph, asc)}</span>` +
    `<div><div class="name">${escapeHtml(sum.name)}</div><div class="small muted">${factionName(sum.faction)} ${escapeHtml(sum.rank)}${sum.turn ? ` · ${escapeHtml(sum.turn)}` : ''}</div></div></div>` +
    `<div class="hpbar"><div style="width:${Math.round(ratio * 100)}%;background:${hpColor(ratio)}"></div></div>` +
    `<div class="stats">${stats}</div>` +
    (tags ? `<div class="tags">${tags}</div>` : '')
  );
}

const STAT_CELLS: ReadonlyArray<readonly [IconName, string, string]> = [
  ['heart', 'HP', 'Hit points'],
  ['sword', 'ATK', 'Attack'],
  ['shield', 'DEF', 'Defense'],
  ['boot', 'MOV', 'Movement'],
  ['target', 'RNG', 'Range'],
];

const STATUS_ICON: Record<string, IconName> = { Dueling: 'swords', Sealed: 'padlock', Drained: 'drop' };

/** Compact stat for the tile strip: icon plus value, the label kept for screen readers and the tooltip. */
function stat(ic: IconName, label: string, value: string): string {
  const long = STAT_CELLS.find((c) => c[1] === label)?.[2] ?? label;
  return `<span class="st" title="${long}">${icon(ic)}<span class="sr">${label} </span>${value}</span>`;
}

/** Selected-unit token: the board's plate shape (rhombus / circle) with the unit glyph; Ascendants get a double rim. */
function tokenSvg(faction: Unit['faction'], glyph: string, asc: boolean): string {
  const rebel = faction === 'rebel';
  const fill = rebel ? '#3e5f82' : '#dcb559';
  const rim = rebel ? '#b4c3d1' : '#fff7df';
  const ink = rebel ? '#f0f4f8' : '#2a1c06';
  const outer = rebel ? '#7fd6ff' : '#fff';
  const shape = (r: number, attrs: string): string =>
    rebel ? `<path d="M16 ${16 - r}L${16 + r} 16 16 ${16 + r} ${16 - r} 16z" ${attrs}/>` : `<circle cx="16" cy="16" r="${r}" ${attrs}/>`;
  const r = rebel ? 13.4 : 12.4;
  return (
    `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">` +
    (asc ? shape(r + 1.8, `fill="none" stroke="${outer}" stroke-width="1.3"`) : '') +
    shape(asc ? r - 1.2 : r, `fill="${fill}" stroke="${rim}" stroke-width="2"`) +
    `<text x="16" y="21.2" fill="${ink}">${escapeHtml(glyph)}</text></svg>`
  );
}

const swatch = (cls: string): string => `<i class="sw ${cls}" aria-hidden="true"></i>`;
const badge = (cls: string, ic: IconName, label: string): string => `<span class="badge ${cls}">${icon(ic)}<span>${label}</span></span>`;

/** Legend: token shapes, rank silhouettes, highlights, status badges, keys (7.3). */
function legendHtml(): string {
  const rank = (r: 'soldier' | 'kindled' | 'radiant' | 'ascendant', label: string, hint: string): string =>
    `<span title="${hint}">${rankIcon(r)}${label}</span>`;
  return (
    '<summary>Legend &amp; keys</summary>' +
    '<div class="legend tokens">' +
    `<span>${tokenIcon('rebel')}<span><b>Rebels</b><small>diamond base, eared hood</small></span></span>` +
    `<span>${tokenIcon('loyalist')}<span><b>Loyalists</b><small>oval base, crested helm</small></span></span>` +
    '</div>' +
    '<div class="legend ranks">' +
    rank('soldier', 'Soldier', 'Axe or spear, smallest') +
    rank('kindled', 'Kindled', 'Glowing blade, pauldrons') +
    rank('radiant', 'Radiant', 'Staff with an orb') +
    rank('ascendant', 'Ascendant', 'Cape, circlet and a double rim') +
    '</div>' +
    '<div class="legend">' +
    `<span>${swatch('sw-move')}Move</span><span>${swatch('sw-attack')}Attack</span><span>${swatch('sw-interact')}Interact</span>` +
    `<span>${swatch('sw-threat')}Enemy reach</span><span>${swatch('sw-crown')}Emperor</span>` +
    badge('dueling', 'swords', 'Dueling') +
    badge('sealed', 'padlock', 'Sealed') +
    badge('drained', 'drop', 'Drained') +
    badge('escapee', 'arrowOut', 'Escapee') +
    '</div>' +
    '<div class="legend"><span><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> cycle units</span><span><kbd>Esc</kbd> deselect</span>' +
    '<span><kbd>E</kbd> end turn</span><span><kbd>W</kbd> wait</span><span><kbd>U</kbd> undo move</span><span><kbd>T</kbd> enemy reach</span>' +
    '<span><kbd>S</kbd> animation speed</span><span><kbd>H</kbd> help</span><span>Hover a target for the damage forecast</span></div>'
  );
}

/**
 * Gives the dialogue box (#dialogue, owned by the controller) its speaker
 * medallion (7.2): whenever the controller writes `.speaker` / `.text`, the
 * children are moved into a text column beside the medallion.
 */
function watchDialogue(): void {
  const el = document.getElementById('dialogue');
  if (!el || typeof MutationObserver !== 'function') return;
  new MutationObserver(() => {
    const first = el.firstElementChild;
    if (!first || !first.classList.contains('speaker')) return;
    const look = speakerLook(first.textContent ?? '');
    const medal = document.createElement('span');
    medal.className = `medal ${look.plate}`;
    medal.innerHTML = medallion(look.plate, look.mark);
    const body = document.createElement('div');
    body.className = 'dlg-body';
    while (el.firstChild) body.appendChild(el.firstChild);
    el.append(medal, body);
  }).observe(el, { childList: true });
}
