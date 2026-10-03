// DOM HUD inside #hud: clock and bells, turn controls, selected unit with
// command buttons, hovered tile info, objectives, event log and legend.
import { findUnit, type GameState } from '../engine';
import type { LogLine } from './eventText';
import { factionName } from './eventText';
import { bellEra, nextBellText, nextWaveText, objectiveRows, tileInfo, unitGlyph, unitSummary, type TileInfo, type UnitSummary } from './hudModel';
import type { Pos } from '../engine';
import { hpColor } from './palette';
import type { Selection } from './selection';

export interface HudCallbacks {
  onEndTurn(): void;
  onCommand(key: string): void;
  onDeselect(): void;
  onNextUnit(): void;
}

export interface HudView {
  state: GameState;
  selection: Selection;
  hover: Pos | null;
  /** Input is locked (animating or AI phase). */
  locked: boolean;
  /** The intro card has been dismissed. */
  started: boolean;
}

const MAX_LOG = 300;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export class Hud {
  private readonly sections: Record<'clock' | 'unit' | 'objectives', HTMLElement>;
  private readonly log: HTMLUListElement;
  private readonly cache = new Map<HTMLElement, string>();

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
      clock: mk('clock-panel'),
      unit: mk('unit-panel', 'Selected'),
      objectives: mk('objectives-panel', 'Objectives'),
    };
    const logBody = mk('log-panel', 'Chronicle');
    this.log = document.createElement('ul');
    this.log.id = 'log';
    logBody.appendChild(this.log);
    const legend = mk('legend-panel');
    legend.innerHTML =
      '<div class="legend">' +
      '<span><i style="background:#3e5f82;border:1px solid #b4c3d1"></i>Rebel</span>' +
      '<span><i style="background:#dcb559;border:1px solid #fff"></i>Loyalist</span>' +
      '<span>Ring = Ascendant</span><span>s/k/r Soldier/Kindled/Radiant</span>' +
      '<span><i style="background:rgba(70,140,255,0.6)"></i>Move</span>' +
      '<span><i style="background:rgba(255,72,60,0.7)"></i>Attack</span>' +
      '<span style="color:#ff6b5b">✕ Dueling</span><span style="color:#8cdcff">◌ Sealed</span><span>▼ Drained</span>' +
      '</div>' +
      '<div class="legend" style="margin-top:4px">Keys: Tab next unit · Esc deselect · E end turn · W wait</div>';

    const onClick = (ev: MouseEvent): void => {
      const t = (ev.target as HTMLElement | null)?.closest('button');
      if (!t || t.disabled) return;
      const cmd = t.getAttribute('data-cmd');
      if (cmd === 'endTurn') this.cb.onEndTurn();
      else if (cmd === 'deselect') this.cb.onDeselect();
      else if (cmd === 'next') this.cb.onNextUnit();
      else if (cmd) this.cb.onCommand(cmd);
    };
    root.addEventListener('click', onClick);
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
            : 'Your turn. Click a rebel unit.';
    const off = !playerTurn || v.locked ? 'disabled' : '';
    this.set(
      this.sections.clock,
      `<p class="title">${escapeHtml(s.scenarioName)}</p>` +
        `<div class="clock"><span>Round <b>${s.round}</b></span><span class="era">${bellEra(s)}</span>` +
        `<span class="phase-pill ${phaseCls}">${phaseText}</span></div>` +
        `<div class="small" style="margin-top:4px">Next: ${escapeHtml(nextBellText(s))}</div>` +
        (wave ? `<div class="small muted">Reinforcements: ${escapeHtml(wave)}</div>` : '') +
        `<div class="small muted" style="margin-top:6px">${status}</div><div class="buttons">` +
        `<button data-cmd="next" ${off}>Next unit (Tab)</button>` +
        `<button class="primary" data-cmd="endTurn" ${off}>End Turn (E)</button>` +
        `</div>`,
    );

    this.set(this.sections.unit, this.unitHtml(v));
    this.set(this.tileEl, this.tileHtml(v));

    const rows = objectiveRows(s);
    this.set(
      this.sections.objectives,
      rows.length === 0
        ? '<div class="muted small">No objectives.</div>'
        : `<ul class="objectives">${rows
            .map(
              (r) =>
                `<li class="${r.status}" title="${escapeHtml(r.hint)}"><span class="icon">${r.icon}</span>` +
                `<span class="name">${escapeHtml(r.name)}</span><span class="type ${r.type}">${r.type}</span></li>`,
            )
            .join('')}</ul>`,
    );
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
    const buttons = v.selection.commands
      .map((c) => {
        const cls = c.kind === 'domain' ? 'domain' : c.kind === 'interact' ? 'interact' : '';
        return `<button class="${cls}" data-cmd="${escapeHtml(c.key)}" ${disabled}>${escapeHtml(c.label)}</button>`;
      })
      .join('');
    const hint =
      v.selection.moves.length > 0 || v.selection.targets.length > 0
        ? `<div class="small muted" style="margin-top:6px">${v.selection.moves.length} tiles in reach (blue), ${v.selection.targets.length} target(s) (red).</div>`
        : '';
    return (
      summaryHtml(sum, unitGlyph(u), u.rank === 'ascendant') +
      hint +
      `<div class="buttons">${buttons}<button data-cmd="deselect" ${disabled}>Deselect (Esc)</button></div>`
    );
  }

  private tileHtml(v: HudView): string {
    if (!v.hover) return '<div class="muted">Hover or tap a tile for terrain, zone and unit details.</div>';
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
        `<span>HP <b>${u.hp}/${u.maxHp}</b></span><span>ATK ${u.atk}</span><span>DEF ${u.def}</span>` +
        `<span>MOV ${u.move}</span><span>RNG ${escapeHtml(u.range)}</span>` +
        (extra.length ? `<span class="muted">${escapeHtml(extra.join(' · '))}</span>` : '') +
        `</div>`;
    }
    return `<div class="ti-tile">${parts.join('<span class="sep">|</span>')}</div>${unitLine}`;
  }

  appendLog(lines: readonly LogLine[]): void {
    if (lines.length === 0) return;
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 30;
    for (const l of lines) {
      const li = document.createElement('li');
      li.className = l.tone;
      li.textContent = l.text;
      this.log.appendChild(li);
    }
    while (this.log.childElementCount > MAX_LOG) this.log.firstElementChild?.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }

  clearLog(): void {
    this.log.innerHTML = '';
  }
}

function summaryHtml(sum: UnitSummary, glyph: string, asc: boolean): string {
  const ratio = sum.maxHp > 0 ? sum.hp / sum.maxHp : 0;
  const tags = [
    ...sum.statuses.map((x) => `<span class="tag status">${escapeHtml(x)}</span>`),
    ...sum.notes.map((x) => `<span class="tag">${escapeHtml(x)}</span>`),
  ].join('');
  return (
    `<div class="unit-head"><span class="token ${sum.faction}${asc ? ' asc' : ''}">${escapeHtml(glyph)}</span>` +
    `<div><div><b>${escapeHtml(sum.name)}</b></div><div class="small muted">${factionName(sum.faction)} ${escapeHtml(sum.rank)}${sum.turn ? ` · ${escapeHtml(sum.turn)}` : ''}</div></div></div>` +
    `<div class="hpbar"><div style="width:${Math.round(ratio * 100)}%;background:${hpColor(ratio)}"></div></div>` +
    `<div class="stats"><span>HP<b>${sum.hp}/${sum.maxHp}</b></span><span>ATK<b>${sum.atk}</b></span>` +
    `<span>DEF<b>${sum.def}</b></span><span>MOV<b>${sum.move}</b></span><span>RNG<b>${sum.range}</b></span></div>` +
    (tags ? `<div class="tags">${tags}</div>` : '')
  );
}
