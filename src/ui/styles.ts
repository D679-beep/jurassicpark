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
#tileinfo .dot.rebel { background: #3e5f82; border: 1px solid #b4c3d1; }
#tileinfo .dot.loyalist { background: #dcb559; border: 1px solid #fff; }
#hud {
  flex: 0 0 var(--hud-w, 294px); width: var(--hud-w, 294px); height: 100%; min-height: 0;
  display: flex; flex-direction: column; gap: 0.5rem;
  overflow-y: auto; overflow-x: hidden; pointer-events: auto;
}
.panel {
  flex: 0 0 auto;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 0.6rem 0.75rem;
}
.panel h2, .legend-panel summary {
  margin: 0 0 0.35rem; font: 600 0.78rem/1.2 system-ui, sans-serif; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--gold-dim);
}
.title { font: 700 1.3rem/1.2 Georgia, 'Times New Roman', serif; color: var(--gold); margin: 0; }
.clock { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; margin-top: 0.3rem; font-size: 1.05rem; }
.clock .era { color: var(--gold); font-weight: 600; }
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
.objectives .icon { font-weight: 700; text-align: center; }
.objectives .completed .icon { color: var(--ok); }
.objectives .failed .icon { color: var(--bad); }
.objectives .failed .name { text-decoration: line-through; color: var(--muted); }
.objectives .pending .icon { color: var(--gold-dim); }
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
button.interact { background: #3a1d22; border-color: #8a4652; color: #ffd8dc; }
.unit-head { display: flex; align-items: center; gap: 0.6rem; }
.unit-head .name { font-size: 1.1rem; font-weight: 700; }
.token {
  width: 2.1rem; height: 2.1rem; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 1.05rem; flex: 0 0 auto;
}
.token.rebel { background: #3e5f82; color: #f0f4f8; border: 2px solid #b4c3d1; }
.token.loyalist { background: #dcb559; color: #2a1c06; border: 2px solid #fff7df; }
.token.asc { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px #7fd6ff; }
.token.loyalist.asc { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px #fff; }
.hpbar { height: 0.45rem; background: #000; border-radius: 3px; overflow: hidden; margin: 0.45rem 0 0.3rem; }
.hpbar > div { height: 100%; }
.stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.25rem; text-align: center; font-size: 0.85rem; color: var(--muted); }
.stats b { display: block; font-size: 1.08rem; color: var(--text); }
.tags { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.4rem; }
.tag { font-size: 0.85rem; padding: 0.05rem 0.45rem; border-radius: 0.6rem; background: #262234; color: var(--muted); }
.tag.status { background: #263a46; color: #bfe7ff; }
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
.legend { display: flex; flex-wrap: wrap; gap: 0.2rem 0.75rem; font-size: 0.85rem; color: var(--muted); }
.legend i { font-style: normal; display: inline-block; width: 0.75rem; height: 0.75rem; border-radius: 2px; margin-right: 0.25rem; vertical-align: -0.1rem; }
.legend + .legend { margin-top: 0.3rem; }
.legend kbd { font: 600 0.8rem/1 system-ui, sans-serif; color: var(--text); border: 1px solid #4a4560; border-radius: 3px; padding: 0.05rem 0.3rem; }
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
  background: linear-gradient(180deg, rgba(20,16,10,0.95), rgba(12,10,8,0.95));
  border: 1px solid var(--gold-dim); border-radius: 8px; padding: 0.75rem 1.1rem;
  box-shadow: 0 6px 24px rgba(0,0,0,0.6); cursor: pointer;
}
#dialogue .speaker { font: 700 1rem/1.2 Georgia, serif; color: var(--gold); letter-spacing: 0.04em; margin-bottom: 0.25rem; }
#dialogue .text { font: italic 1.2rem/1.4 Georgia, 'Times New Roman', serif; color: var(--dialogue); }
#overlay {
  position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, rgba(20,16,30,0.9), rgba(5,4,8,0.97));
  padding: 1rem; overflow: hidden;
}
.card {
  width: min(48rem, 100%); background: var(--panel); border: 1px solid var(--gold-dim); border-radius: 10px;
  padding: 1.4rem 1.8rem; box-shadow: 0 10px 50px rgba(0,0,0,0.7); max-height: 100%; overflow-y: auto;
}
.card h1 { font: 700 2.15rem/1.15 Georgia, 'Times New Roman', serif; color: var(--gold); margin: 0 0 0.3rem; }
.card .kicker { font-size: 0.85rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--gold-dim); }
.card .framing { font: italic 1.2rem/1.5 Georgia, serif; color: var(--dialogue); margin: 0.8rem 0 0.9rem; }
.card h3 { font-size: 0.9rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold-dim); margin: 1rem 0 0.45rem; }
.card ul { margin: 0; padding-left: 1.3rem; }
.card li { margin: 0.2rem 0; }
.card ul.objective-grid { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1.4rem; }
.card ul.objective-grid li { margin: 0; }
.card .hint { color: var(--muted); font-size: 0.92rem; }
.card .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1.4rem; }
.card .actions { margin-top: 1.2rem; display: flex; justify-content: flex-end; align-items: center; gap: 1rem; }
.card .actions .hint { margin-right: auto; }
.card .actions button { font-size: 1.15rem; padding: 0.7rem 1.7rem; }
.card.victory h1 { color: #9fe0a8; }
.card.defeat h1 { color: #f39a8a; }
`;
