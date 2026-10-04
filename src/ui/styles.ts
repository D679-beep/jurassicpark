// Page and HUD styles, injected at mount (keeps the build free of CSS tooling).
//
// Laptop layout (1280x720 up to 1920x1080): board column on the left, HUD
// column on the right, hovered-tile strip under the board. The controller
// sets the sizes computed in layout.ts as custom properties on <html>:
//   --fs      root font size (everything below is in rem, so it scales)
//   --hud-w   HUD column width
//   --info-h  tile-info strip height
//   --board-w board width (the strip matches it)
// The fallbacks are the 1280x720 values.
export const STYLES = `
:root {
  --bg: #0b0a10;
  --panel: #14121c;
  --panel-2: #1b1826;
  --line: #2c2838;
  --text: #e8e2d0;
  --muted: #a39d8e;
  --gold: #e8c872;
  --gold-dim: #9c8344;
  --storm: #7fb4e6;
  --loyal: #e3bd5f;
  --ok: #7fd18a;
  --bad: #ef7a6a;
  --dialogue: #f4e6bf;
  --st-dueling: #ff7a5c;
  --st-sealed: #8cdcff;
  --st-drained: #b5a8d6;
  --st-escapee: #7fe0d0;
  --gutter: 8px;
  --col-gap: 10px;
  --strip-gap: 4px;
  color-scheme: dark;
  font-size: var(--fs, 13px);
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; width: 100%; height: 100%;
  background: var(--bg); color: var(--text);
  overflow: hidden;
}
body { font: 1rem/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
#app {
  display: flex; flex-direction: row; gap: var(--col-gap);
  width: 100%; height: 100%; padding: var(--gutter);
}
#board {
  position: relative; flex: 1 1 auto; min-width: 0; min-height: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--strip-gap);
}
#board-inner { position: relative; line-height: 0; flex: 0 0 auto; }
#game {
  display: block; image-rendering: pixelated; touch-action: manipulation;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; outline: none;
  box-shadow: 0 0 0 1px var(--line), 0 0 40px rgba(232,200,114,0.06);
  cursor: pointer;
}
#game.locked { cursor: progress; }
#tileinfo {
  flex: 0 0 auto; width: var(--board-w, 100%); max-width: 100%; height: var(--info-h, 39px); overflow: hidden;
  background: var(--panel); border: 1px solid var(--line); border-radius: 5px;
  padding: 3px 0.75rem; font-size: 0.95rem; line-height: 1.25;
  display: flex; flex-direction: column; justify-content: center;
}
#tileinfo .ti-tile, #tileinfo .ti-unit {
  display: flex; flex-wrap: nowrap; gap: 0 0.6em; align-items: baseline;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#tileinfo .ti-unit > * { flex: 0 0 auto; }
#tileinfo .sep { color: #4a4458; }
#tileinfo .zone { color: var(--gold); }
#tileinfo .dot { width: 0.7em; height: 0.7em; border-radius: 50%; display: inline-block; align-self: center; }
#tileinfo .dot.rebel { background: #3e5f82; border: 1px solid #b4c3d1; border-radius: 1px; transform: rotate(45deg) scale(0.85); }
#tileinfo .dot.loyalist { background: #dcb559; border: 1px solid #fff; }
#tileinfo .st { display: inline-flex; align-items: center; gap: 0.2em; }
#tileinfo .st .ic { color: var(--gold-dim); }
#hud {
  flex: 0 0 var(--hud-w, 294px); width: var(--hud-w, 294px); height: 100%; min-height: 0;
  display: flex; flex-direction: column; gap: 0.5rem;
  overflow-y: auto; overflow-x: hidden; pointer-events: auto;
}
.panel {
  flex: 0 0 auto;
  background: linear-gradient(180deg, #181520, #13111b); border: 1px solid var(--line); border-radius: 6px;
  padding: 0.6rem 0.75rem; box-shadow: inset 0 1px 0 rgba(232,200,114,0.07);
}
.ic { width: 1em; height: 1em; flex: none; vertical-align: -0.14em; overflow: visible; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.panel h2, .legend-panel summary {
  margin: 0 0 0.35rem; font: 600 0.78rem/1.2 system-ui, sans-serif; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--gold-dim);
}
.titlebar { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }
.title { font: 700 1.3rem/1.2 Georgia, 'Times New Roman', serif; color: var(--gold); margin: 0; min-width: 0; text-shadow: 0 0 14px rgba(232,200,114,0.2); }
button.speed {
  flex: none; display: inline-flex; align-items: center; gap: 0.3em; min-height: 1.6rem; padding: 0.1rem 0.55rem 0.1rem 0.45rem;
  font-size: 0.78rem; border-radius: 1rem; color: var(--gold); background: #1d1810; border-color: var(--gold-dim);
}
button.speed .ic { font-size: 1.05em; }
button.speed:hover:not(:disabled) { background: #2a2314; border-color: var(--gold); }
.clock { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.7rem; margin-top: 0.3rem; font-size: 1.05rem; }
.clock .era { color: var(--gold); font-weight: 600; }
.bells { display: inline-flex; align-items: center; gap: 0.2rem; font-size: 0.95rem; }
.bells .rung { color: var(--gold); filter: drop-shadow(0 0 3px rgba(232,200,114,0.45)); }
.bells .pending { color: var(--gold-dim); }
.turn-info .ic { color: var(--gold-dim); margin-right: 0.25em; }
.phase-pill {
  display: inline-block; padding: 0.05rem 0.6rem; border-radius: 1rem; font-size: 0.9rem; font-weight: 600;
}
.phase-pill.rebel { background: #23384f; color: #cfe4fa; }
.phase-pill.loyalist { background: #4d3d17; color: #f6e2a8; }
.muted { color: var(--muted); }
.small { font-size: 0.92rem; }
.turn-info { margin-top: 0.3rem; line-height: 1.35; }
.status { margin-top: 0.3rem; color: var(--muted); font-size: 0.92rem; }
.status.yours { color: #cfe4fa; }
.objectives { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.objectives li { display: grid; grid-template-columns: 1.2rem 1fr auto; gap: 0.4rem; align-items: baseline; }
.objectives .icon { text-align: center; }
.oi { position: relative; display: inline-block; font-size: 1.05rem; line-height: 1; color: var(--gold); }
.oi > .ic { vertical-align: -0.14em; }
.oi-mark { position: absolute; right: -0.3em; bottom: -0.28em; font-size: 0.62em; line-height: 0; border-radius: 50%; background: var(--panel); padding: 0.06em; }
.oi.pending .oi-mark { color: var(--gold-dim); }
.oi.completed, .oi.completed .oi-mark { color: var(--ok); }
.oi.failed, .oi.failed .oi-mark { color: var(--bad); }
.objectives .failed .name { text-decoration: line-through; color: var(--muted); }
.objectives .type { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.objectives .type.required { color: var(--gold); }
.buttons { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.55rem; }
.buttons button { flex: 1 1 auto; }
button {
  font: 600 0.98rem/1.1 system-ui, sans-serif; color: var(--text);
  background: var(--panel-2); border: 1px solid #3a3550; border-radius: 5px;
  padding: 0.45rem 0.7rem; cursor: pointer; min-height: 2.45rem;
}
button kbd {
  font: 600 0.78rem/1 system-ui, sans-serif; color: var(--muted);
  border: 1px solid #4a4560; border-radius: 3px; padding: 0.1rem 0.3rem; margin-left: 0.35rem;
  vertical-align: 0.05rem;
}
button.primary kbd { color: #e8d39a; border-color: #7a6634; }
button:hover:not(:disabled) { border-color: var(--gold-dim); background: #221e30; }
button:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
button.primary { background: #3a2f12; border-color: var(--gold-dim); color: #fbe7ae; }
button.primary:hover:not(:disabled) { background: #4a3b16; }
button.domain { background: #1f2a44; border-color: #4a6aa8; color: #d4e2ff; }
button.domain .ic { margin-right: 0.35em; vertical-align: -0.16em; }
button.interact { background: #3a1d22; border-color: #8a4652; color: #ffd8dc; }
.unit-head { display: flex; align-items: center; gap: 0.6rem; }
.unit-head .name { font-size: 1.1rem; font-weight: 700; }
.token { width: 2.3rem; height: 2.3rem; flex: 0 0 auto; display: block; }
.token svg { display: block; width: 100%; height: 100%; overflow: visible; }
.token text { font: 800 15px Georgia, 'Times New Roman', serif; text-anchor: middle; }
.hpbar { height: 0.45rem; background: #000; border-radius: 3px; overflow: hidden; margin: 0.45rem 0 0.3rem; }
.hpbar > div { height: 100%; }
.stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.25rem; text-align: center; font-size: 0.85rem; color: var(--muted); }
.stats .lab { display: inline-flex; align-items: center; justify-content: center; gap: 0.18em; }
.stats .lab .ic { color: var(--gold-dim); font-size: 0.95em; }
.stats b { display: block; font-size: 1.08rem; color: var(--text); }
.tags { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.4rem; }
.tag { font-size: 0.85rem; padding: 0.05rem 0.45rem; border-radius: 0.6rem; background: #262234; color: var(--muted); }
.tag.status { background: #263a46; color: #bfe7ff; display: inline-flex; align-items: center; gap: 0.3em; }
.tag.s-dueling { background: #3d241f; color: var(--st-dueling); }
.tag.s-sealed { background: #1f3340; color: var(--st-sealed); }
.tag.s-drained { background: #2c2740; color: var(--st-drained); }
.log-panel { flex: 1 1 auto; min-height: 5.5rem; display: flex; flex-direction: column; }
.log-panel > div { flex: 1 1 auto; min-height: 0; position: relative; }
#log {
  list-style: none; margin: 0; padding: 0 0.2rem 0 0; overflow-y: auto; position: absolute; inset: 0;
  font-size: 0.92rem; display: flex; flex-direction: column; gap: 0.1rem;
  scrollbar-width: thin; scrollbar-color: #3a3550 transparent;
}
#log li { padding: 0.05rem 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
#log .damage { color: #f1b3a6; }
#log .heal { color: #b6f0b9; }
#log .death { color: #ff8e7e; font-weight: 600; }
#log .domain { color: #bcd0ff; }
#log .bell { color: var(--gold); font-weight: 600; }
#log .objective { color: var(--ok); }
#log .fail { color: var(--bad); }
#log .dialogue { color: var(--dialogue); font-style: italic; }
#log .phase { color: var(--muted); margin-top: 0.3rem; border-top: 1px solid var(--line); padding-top: 0.2rem; }
#log .move { color: #8f8a9c; }
#log .victory { color: var(--ok); font-weight: 700; }
#log .defeat { color: var(--bad); font-weight: 700; }
.legend-panel { padding-top: 0.45rem; padding-bottom: 0.45rem; }
.legend-panel summary { cursor: pointer; margin: 0; list-style-position: inside; }
.legend-panel[open] summary { margin-bottom: 0.35rem; }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; font-size: 0.85rem; color: var(--muted); }
.legend + .legend { margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.05); }
.legend > span { display: inline-flex; align-items: center; gap: 0.3em; }
.legend i { font-style: normal; display: inline-block; width: 0.75rem; height: 0.75rem; border-radius: 2px; vertical-align: -0.1rem; }
.legend kbd { font: 600 0.8rem/1 system-ui, sans-serif; color: var(--text); border: 1px solid #4a4560; border-radius: 3px; padding: 0.05rem 0.3rem; }
.legend.tokens { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem 0.6rem; align-items: start; }
.legend.tokens > span { align-items: center; gap: 0.45em; line-height: 1.15; }
.legend.tokens .ic-token { width: 1.9em; height: 1.9em; }
.legend.tokens b { display: block; color: var(--text); font-weight: 600; }
.legend.tokens small { display: block; font-size: 0.92em; }
.legend.tokens .rim { grid-column: 1 / -1; }
.legend.ranks { justify-content: space-between; gap: 0.2rem 0.4rem; }
.legend.ranks > span { flex-direction: column; gap: 0.1em; font-size: 0.8rem; }
.legend.ranks .ic { width: 1.7em; height: 1.7em; color: #cfc8b6; }
.legend .badge .ic { font-size: 1.15em; }
.legend .badge.dueling { color: var(--st-dueling); }
.legend .badge.sealed { color: var(--st-sealed); }
.legend .badge.drained { color: var(--st-drained); }
.legend .badge.escapee { color: var(--st-escapee); }
.legend .badge span { color: var(--muted); }
#tooltip {
  position: absolute; pointer-events: none; z-index: 5; display: none;
  background: rgba(10,9,14,0.95); border: 1px solid var(--gold-dim); border-radius: 5px;
  padding: 0.45rem 0.65rem; font: 0.95rem/1.35 system-ui, sans-serif; color: var(--text); white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0,0,0,0.5);
}
#tooltip .dmg { color: #ffb4a6; font-weight: 700; font-size: 1.08rem; }
#dialogue {
  position: absolute; left: 50%; bottom: 0.9rem; transform: translateX(-50%);
  width: min(88%, 46rem); z-index: 4; display: none; line-height: 1.4;
  background: linear-gradient(180deg, rgba(26,20,13,0.96), rgba(12,10,8,0.96));
  border: 1px solid var(--gold-dim); border-radius: 8px; padding: 0.75rem 1.1rem;
  box-shadow: inset 0 0 0 3px rgba(12,10,8,0.9), inset 0 0 0 4px rgba(232,200,114,0.18), 0 6px 24px rgba(0,0,0,0.6); cursor: pointer;
}
#dialogue[style*="block"] { display: flex !important; align-items: center; gap: 0.9rem; }
#dialogue .dlg-body { min-width: 0; flex: 1 1 auto; }
#dialogue .medal { flex: 0 0 auto; width: 2.6rem; height: 2.6rem; display: block; filter: drop-shadow(0 0 6px rgba(232,200,114,0.25)); }
#dialogue .medal svg { display: block; width: 100%; height: 100%; }
#dialogue .speaker { font: 700 1rem/1.2 Georgia, serif; color: var(--gold); letter-spacing: 0.04em; margin-bottom: 0.25rem; }
#dialogue .text { font: italic 1.2rem/1.4 Georgia, 'Times New Roman', serif; color: var(--dialogue); }
#overlay {
  position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 40%, rgba(40,28,20,0.85), rgba(4,4,8,0.97));
  padding: 1rem; overflow: hidden;
}
.card {
  --ring: rgba(232,200,114,0.22); --edge: #9c8344;
  position: relative; width: min(48rem, 100%); border: 1px solid var(--edge); border-radius: 10px;
  background: radial-gradient(ellipse at 50% 0, rgba(232,200,114,0.07), transparent 55%), linear-gradient(180deg, #17141f, #0f0d15);
  padding: 1.4rem 1.8rem; max-height: 100%; overflow-y: auto;
  box-shadow: inset 0 0 0 4px #14121c, inset 0 0 0 5px var(--ring), 0 10px 50px rgba(0,0,0,0.7);
}
.card.victory { --edge: rgba(127,209,138,0.6); --ring: rgba(127,209,138,0.22); }
.card.defeat { --edge: rgba(239,122,106,0.6); --ring: rgba(239,122,106,0.22); }
.card h1 {
  position: relative; font: 700 2.15rem/1.15 Georgia, 'Times New Roman', serif; color: var(--gold); margin: 0 0 1rem;
  padding-bottom: 0.7rem; text-shadow: 0 0 18px rgba(232,200,114,0.25);
}
.card h1::before {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
  background: linear-gradient(90deg, transparent, var(--edge), transparent);
}
.card h1::after {
  content: ''; position: absolute; left: 50%; bottom: -3px; width: 6px; height: 6px; margin-left: -3px;
  background: var(--edge); transform: rotate(45deg);
}
.card .kicker { display: flex; align-items: center; gap: 0.5em; font-size: 0.85rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--gold-dim); margin-bottom: 0.2rem; }
.card .kicker .ic { font-size: 1.12em; color: var(--gold); filter: drop-shadow(0 0 4px rgba(232,200,114,0.5)); }
.card .framing { font: italic 1.2rem/1.5 Georgia, serif; color: var(--dialogue); margin: 0 0 0.9rem; }
.card h3 { font-size: 0.9rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold-dim); margin: 1rem 0 0.45rem; }
.card ul { margin: 0; padding-left: 1.3rem; }
.card li { margin: 0.2rem 0; }
.card ul.objective-grid { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1.4rem; }
.card ul.objective-grid li { margin: 0; display: grid; grid-template-columns: 1.5rem 1fr; gap: 0.15rem 0.55rem; align-items: start; }
.card .oi { font-size: 1.2rem; margin-top: 0.1rem; }
.card .otype { font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-left: 0.3em; }
.card .otype.required { color: var(--gold); }
.card ul.rows { list-style: none; padding-left: 0; }
.card ul.rows li { display: grid; grid-template-columns: 1.6rem 1fr; gap: 0.5rem; align-items: center; }
.card .bell-line { display: flex; flex-wrap: wrap; gap: 0.2rem 1rem; }
.card .bell-line .ic { color: var(--gold); margin-right: 0.3em; }
.card .hint { color: var(--muted); font-size: 0.92rem; }
.card .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1.4rem; }
.card .actions { margin-top: 1.2rem; display: flex; justify-content: flex-end; align-items: center; gap: 1rem; }
.card .actions .hint { margin-right: auto; }
.card .actions button { font-size: 1.15rem; padding: 0.7rem 1.7rem; }
.card.victory h1, .card.victory .kicker .ic { color: #9fe0a8; }
.card.defeat h1, .card.defeat .kicker .ic { color: #f39a8a; }
.card.victory h1 { text-shadow: 0 0 18px rgba(127,209,138,0.25); }
.card.defeat h1 { text-shadow: 0 0 18px rgba(239,122,106,0.25); }
`;
