// "How to play": a modal <dialog> with the goal, the bells, the rules in brief,
// every control, a map legend and the preferences. It is rebuilt from the live
// GameState each time it opens, so objectives and bell rounds are never stale.
// <dialog> gives focus trapping, Esc and a backdrop for free; its form buttons
// (method="dialog") close it without any script.
import type { GameState } from '../engine';
import { escapeHtml } from './hud';
import { CONTROLS, helpModel, type ControlGroup } from './helpModel';
import { icon, objectiveIcon } from './icons';
import { SPEEDS, speedLabel, type ReduceMotionPref, type Settings, type SettingsStore } from './settings';
import type { Speed } from './gfx/types';

const kbd = (keys: readonly string[]): string => keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join(' ');

const REDUCE_LABELS: Record<ReduceMotionPref, string> = { system: 'Follow my system', on: 'On', off: 'Off' };

function controlsHtml(groups: readonly ControlGroup[]): string {
  return groups
    .map(
      (g) =>
        `<h3>${escapeHtml(g.group)}</h3><dl class="controls">` +
        g.rows.map((r) => `<div><dt>${kbd(r.keys)}</dt><dd>${escapeHtml(r.text)}</dd></div>`).join('') +
        '</dl>',
    )
    .join('');
}

const legendRow = (cls: string, text: string): string => `<li><i class="sw ${cls}" aria-hidden="true"></i><span>${text}</span></li>`;

/** The dialog's inner HTML for a state and the current settings. Pure string building. */
export function helpHtml(state: GameState, settings: Readonly<Settings>): string {
  const m = helpModel(state);
  const objectives = m.objectives
    .map(
      (o) =>
        `<li class="${o.status}"><span class="oi-wrap">${objectiveIcon(o.id, o.status)}</span><div><b>${escapeHtml(o.name)}</b> ` +
        `<span class="otype ${o.type}">${o.type}</span><div class="hint">${escapeHtml(o.hint)}</div></div></li>`,
    )
    .join('');
  const bells = m.bells
    .map((b) => `<li class="${b.rung ? 'rung' : ''}">${icon(b.rung ? 'bell' : 'bellOff')}<span>${escapeHtml(b.name)}: round ${b.round}${b.rung ? ' (rung)' : ''}</span></li>`)
    .join('');
  const waves = m.waves.map((w) => `<li>${icon('banner')}<span>${escapeHtml(w.name)}: ${w.units} units, round ${w.round}</span></li>`).join('');
  const speedOptions = SPEEDS.map((s: Speed) => `<option value="${s}"${s === settings.speed ? ' selected' : ''}>${escapeHtml(speedLabel(s))}</option>`).join('');
  const reduceOptions = (Object.keys(REDUCE_LABELS) as ReduceMotionPref[])
    .map((k) => `<option value="${k}"${k === settings.reduceMotion ? ' selected' : ''}>${REDUCE_LABELS[k]}</option>`)
    .join('');
  return (
    `<header class="help-head"><h1 id="help-title">How to play</h1>` +
    `<button type="submit" value="close" class="help-close" aria-label="Close help">${icon('cross')}</button></header>` +
    `<div class="help-body">` +
    `<section><h2>Your goal</h2><ul class="help-objectives">${objectives}</ul>` +
    `<p class="help-tip"><b>Confronting the Emperor:</b> only Varek can, standing beside him. Select Varek and click the Emperor. ` +
    `If Varek can reach him this turn he walks up and Confronts; if not, the Objectives panel says how far away he is. ` +
    `A crown marks the Emperor on the map and glows when you can Confront.</p></section>` +
    `<section><h2>The bells</h2><ul class="help-list">${bells}${waves}</ul>` +
    `<p class="hint">Each bell brings loyalist reinforcements. The clock panel shows the next one.</p></section>` +
    `<section><h2>Rules in brief</h2><ul class="help-rules">${m.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul></section>` +
    `<section><h2>Controls</h2>${controlsHtml(CONTROLS)}</section>` +
    `<section><h2>Reading the map</h2><ul class="help-legend">` +
    legendRow('sw-move', '<b>Blue tiles</b>: where the selected unit can move.') +
    legendRow('sw-attack', '<b>Red tiles with corner marks</b>: enemies it can attack from where it stands.') +
    legendRow('sw-interact', '<b>Amber tiles with a diamond</b>: something to interact with (Confront, Capture, burn a bridge). Click it.') +
    legendRow('sw-stand', '<b>Blue tiles with an amber corner</b>: from here an interaction becomes possible. Click the target to walk to one.') +
    legendRow('sw-threat', '<b>Purple hatching</b> (T): tiles the loyalists can attack next turn; darker where more of them reach. Reinforcements and Domains are not counted.') +
    legendRow('sw-crown', '<b>Crown</b>: the Emperor. It glows when Varek can Confront him now.') +
    `</ul></section>` +
    `<section><h2>Preferences</h2>` +
    `<label class="pref"><input type="checkbox" data-pref="confirmEndTurn"${settings.confirmEndTurn ? ' checked' : ''}><span>Ask before ending a turn while units can still act</span></label>` +
    `<label class="pref"><span>Reduce motion</span><select data-pref="reduceMotion">${reduceOptions}</select></label>` +
    `<label class="pref"><span>Animation speed</span><select data-pref="speed">${speedOptions}</select></label>` +
    `</section></div>` +
    `<footer class="help-foot"><button type="submit" value="close" class="primary">Got it<kbd>Esc</kbd></button></footer>`
  );
}

export class HelpDialog {
  private readonly el: HTMLDialogElement;
  private readonly form: HTMLFormElement;

  constructor(
    private readonly getState: () => GameState,
    private readonly settings: SettingsStore,
  ) {
    this.el = document.createElement('dialog');
    this.el.id = 'help';
    this.el.className = 'help';
    this.el.setAttribute('aria-labelledby', 'help-title');
    this.form = document.createElement('form');
    this.form.method = 'dialog';
    this.el.appendChild(this.form);
    document.body.appendChild(this.el);
    // A click on the backdrop lands on the dialog element itself.
    this.el.addEventListener('click', (ev) => {
      if (ev.target === this.el) this.close();
    });
    this.form.addEventListener('change', (ev) => this.onPref(ev.target as HTMLElement));
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  open(): void {
    if (this.el.open) return;
    this.form.innerHTML = helpHtml(this.getState(), this.settings.settings);
    if (typeof this.el.showModal === 'function') this.el.showModal();
    else this.el.setAttribute('open', '');
    this.form.querySelector<HTMLElement>('.help-body')?.scrollTo?.(0, 0);
  }

  close(): void {
    if (!this.el.open) return;
    if (typeof this.el.close === 'function') this.el.close();
    else this.el.removeAttribute('open');
  }

  toggle(): void {
    if (this.el.open) this.close();
    else this.open();
  }

  private onPref(t: HTMLElement): void {
    const pref = t.getAttribute('data-pref');
    if (!pref) return;
    if (t instanceof HTMLInputElement && pref === 'confirmEndTurn') this.settings.setConfirmEndTurn(t.checked);
    else if (t instanceof HTMLSelectElement && pref === 'reduceMotion') this.settings.setReduceMotion(t.value as ReduceMotionPref);
    else if (t instanceof HTMLSelectElement && pref === 'speed') this.settings.setSpeed(t.value as Speed);
  }
}
