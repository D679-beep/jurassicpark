// Intro and result cards: full-screen DOM overlays.
import type { GameResult, GameState } from '../engine';
import { outcomeLines } from './eventText';
import { objectiveRows } from './hudModel';
import { escapeHtml } from './hud';
import { icon, objectiveIcon, objectiveIconName } from './icons';

function overlay(): HTMLElement {
  let el = document.getElementById('overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'overlay';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
  return el;
}

export function hideOverlay(): void {
  const el = document.getElementById('overlay');
  if (el) {
    el.style.display = 'none';
    el.innerHTML = '';
  }
}

export interface IntroOptions {
  state: GameState;
  framing: string;
  onBegin(): void;
}

export function showIntro(o: IntroOptions): void {
  const el = overlay();
  const s = o.state;
  const objectives = objectiveRows(s)
    .map(
      (r) =>
        `<li><span class="oi">${icon(objectiveIconName(r.id))}</span><div><b>${escapeHtml(r.name)}</b>` +
        `<span class="otype ${r.type}">${r.type}</span><div class="hint">${escapeHtml(r.hint)}</div></div></li>`,
    )
    .join('');
  const bells = [...s.bells]
    .sort((a, b) => a.round - b.round)
    .map((b) => `<span>${icon('bell')}${escapeHtml(b.name)}: round ${b.round}</span>`)
    .join('');
  el.innerHTML =
    `<div class="card intro" role="dialog" aria-labelledby="intro-title">` +
    `<div class="kicker">${icon('lantern')}Prologue</div>` +
    `<h1 id="intro-title">${escapeHtml(s.scenarioName)}</h1>` +
    `<p class="framing">${escapeHtml(o.framing)}</p>` +
    `<h3>Objectives</h3><ul class="objective-grid">${objectives}</ul>` +
    `<div class="facts"><div><h3>The bells</h3><div class="bell-line">${bells}</div>` +
    `<div class="hint">Each bell brings loyalist reinforcements.</div></div>` +
    `<div><h3>Defeat</h3><div class="hint">If Varek or Kaela falls, or Dawn arrives with the Emperor alive.</div></div></div>` +
    `<div class="actions"><span class="hint">Click a unit to select it, click a blue tile to move, a red one to attack. ` +
    `Tab cycles units, E ends the turn.</span><button class="primary" id="begin-btn">Begin</button></div>` +
    `</div>`;
  const btn = el.querySelector<HTMLButtonElement>('#begin-btn');
  btn?.addEventListener('click', () => {
    hideOverlay();
    o.onBegin();
  });
  btn?.focus();
}

export interface ResultOptions {
  state: GameState;
  result: GameResult;
  onPlayAgain(): void;
}

export function showResult(o: ResultOptions): void {
  const el = overlay();
  const r = o.result;
  const lines = outcomeLines(r.outcome)
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join('');
  const objectives = objectiveRows(o.state)
    .map((row) => `<li>${objectiveIcon(row.id, row.status)}<span>${escapeHtml(row.name)} <span class="hint">(${row.status})</span></span></li>`)
    .join('');
  el.innerHTML =
    `<div class="card ${r.result}" role="dialog" aria-labelledby="result-title">` +
    `<div class="kicker">${icon(r.result === 'victory' ? 'sun' : 'lantern')}Round ${o.state.round}</div>` +
    `<h1 id="result-title">${r.result === 'victory' ? 'Victory' : 'Defeat'}</h1>` +
    `<p class="framing">${escapeHtml(r.reason)}.</p>` +
    `<div class="facts"><div><h3>The night's outcome</h3><ul>${lines}</ul></div>` +
    `<div><h3>Objectives</h3><ul class="rows">${objectives}</ul></div></div>` +
    `<div class="actions"><button class="primary" id="again-btn">Play again</button></div>` +
    `</div>`;
  const btn = el.querySelector<HTMLButtonElement>('#again-btn');
  btn?.addEventListener('click', () => {
    hideOverlay();
    o.onPlayAgain();
  });
  btn?.focus();
}
