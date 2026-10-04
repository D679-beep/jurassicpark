// Page and HUD styles, injected at mount (keeps the build free of CSS tooling).
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
  color-scheme: dark;
}
* { box-sizing: border-box; }
button, #board { -webkit-tap-highlight-color: transparent; }
html, body {
  margin: 0; padding: 0; width: 100%; height: 100%;
  background: var(--bg); color: var(--text);
  font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
  overflow: hidden;
}
#app {
  display: flex; flex-direction: row; gap: 16px;
  width: 100%; height: 100%; padding: 16px;
}
#board {
  position: relative; flex: 1 1 auto; min-width: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
}
#tileinfo {
  width: 100%; max-width: var(--board-w, 100%); height: 56px; overflow: hidden;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 6px 10px; font-size: 12px; line-height: 1.5;
}
#tileinfo .ti-tile, #tileinfo .ti-unit { display: flex; flex-wrap: wrap; gap: 0 8px; align-items: baseline; }
#tileinfo .sep { color: var(--line); }
#tileinfo .zone { color: var(--gold); }
#tileinfo .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; align-self: center; }
#tileinfo .dot.rebel { background: #3e5f82; border: 1px solid #b4c3d1; }
#tileinfo .dot.loyalist { background: #dcb559; border: 1px solid #fff; }
#board-inner { position: relative; line-height: 0; }
#game {
  display: block; image-rendering: pixelated; touch-action: manipulation;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; outline: none;
  border: 1px solid var(--line); border-radius: 4px;
  box-shadow: 0 0 40px rgba(232,200,114,0.06);
  cursor: pointer;
}
#game.locked { cursor: progress; }
#hud {
  flex: 0 0 340px; width: 340px; height: 100%;
  display: flex; flex-direction: column; gap: 10px;
  overflow-y: auto; overflow-x: hidden; pointer-events: auto;
}
.panel {
  flex: 0 0 auto;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 10px 12px;
}
.panel h2 {
  margin: 0 0 6px; font: 600 11px/1.2 system-ui, sans-serif; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--gold-dim);
}
.title { font: 700 18px/1.2 Georgia, 'Times New Roman', serif; color: var(--gold); margin: 0; }
.clock { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; }
.clock .era { color: var(--gold); font-weight: 600; }
.phase-pill {
  display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; font-weight: 600;
}
.phase-pill.rebel { background: #23384f; color: #cfe4fa; }
.phase-pill.loyalist { background: #4d3d17; color: #f6e2a8; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.objectives { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.objectives li { display: grid; grid-template-columns: 18px 1fr auto; gap: 6px; align-items: baseline; }
.objectives .icon { font-weight: 700; text-align: center; }
.objectives .completed .icon { color: var(--ok); }
.objectives .failed .icon { color: var(--bad); }
.objectives .failed .name { text-decoration: line-through; color: var(--muted); }
.objectives .pending .icon { color: var(--gold-dim); }
.objectives .type { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.objectives .type.required { color: var(--gold); }
.buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
button {
  font: 600 13px/1 system-ui, sans-serif; color: var(--text);
  background: var(--panel-2); border: 1px solid #3a3550; border-radius: 5px;
  padding: 8px 11px; cursor: pointer; min-height: 34px;
}
button:hover:not(:disabled) { border-color: var(--gold-dim); background: #221e30; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
button.primary { background: #3a2f12; border-color: var(--gold-dim); color: #fbe7ae; }
button.primary:hover:not(:disabled) { background: #4a3b16; }
button.domain { background: #1f2a44; border-color: #4a6aa8; color: #d4e2ff; }
button.interact { background: #3a1d22; border-color: #8a4652; color: #ffd8dc; }
.unit-head { display: flex; align-items: center; gap: 8px; }
.token {
  width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 13px; flex: 0 0 auto;
}
.token.rebel { background: #3e5f82; color: #f0f4f8; border: 2px solid #b4c3d1; }
.token.loyalist { background: #dcb559; color: #2a1c06; border: 2px solid #fff7df; }
.token.asc { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px #7fd6ff; }
.token.loyalist.asc { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px #fff; }
.hpbar { height: 6px; background: #000; border-radius: 3px; overflow: hidden; margin: 6px 0 4px; }
.hpbar > div { height: 100%; }
.stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; text-align: center; font-size: 12px; }
.stats b { display: block; font-size: 14px; color: var(--text); }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tag { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: #262234; color: var(--muted); }
.tag.status { background: #263a46; color: #bfe7ff; }
.log-panel { flex: 1 1 auto; min-height: 150px; display: flex; flex-direction: column; }
.log-panel > div { flex: 1 1 auto; min-height: 0; position: relative; }
#log {
  list-style: none; margin: 0; padding: 0; overflow-y: auto; position: absolute; inset: 0;
  font-size: 12px; display: flex; flex-direction: column; gap: 2px;
}
#log li { padding: 1px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
#log .damage { color: #f1b3a6; }
#log .heal { color: #b6f0b9; }
#log .death { color: #ff8e7e; font-weight: 600; }
#log .domain { color: #bcd0ff; }
#log .bell { color: var(--gold); font-weight: 600; }
#log .objective { color: var(--ok); }
#log .fail { color: var(--bad); }
#log .dialogue { color: var(--dialogue); font-style: italic; }
#log .phase { color: var(--muted); margin-top: 4px; border-top: 1px solid var(--line); padding-top: 3px; }
#log .move { color: #8f8a9c; }
#log .victory { color: var(--ok); font-weight: 700; }
#log .defeat { color: var(--bad); font-weight: 700; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--muted); }
.legend i { font-style: normal; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 3px; vertical-align: -1px; }
#tooltip {
  position: absolute; pointer-events: none; z-index: 5; display: none;
  background: rgba(10,9,14,0.94); border: 1px solid var(--gold-dim); border-radius: 5px;
  padding: 6px 8px; font: 12px/1.35 system-ui, sans-serif; color: var(--text); white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0,0,0,0.5);
}
#tooltip .dmg { color: #ffb4a6; font-weight: 700; font-size: 13px; }
#dialogue {
  position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%);
  width: min(92%, 640px); z-index: 4; display: none; line-height: 1.4;
  background: linear-gradient(180deg, rgba(20,16,10,0.95), rgba(12,10,8,0.95));
  border: 1px solid var(--gold-dim); border-radius: 8px; padding: 10px 14px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.6); cursor: pointer;
}
#dialogue .speaker { font: 700 13px/1.2 Georgia, serif; color: var(--gold); letter-spacing: 0.04em; margin-bottom: 3px; }
#dialogue .text { font: italic 16px/1.4 Georgia, 'Times New Roman', serif; color: var(--dialogue); }
#overlay {
  position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, rgba(20,16,30,0.9), rgba(5,4,8,0.97));
  padding: 16px; overflow-y: auto;
}
.card {
  width: min(560px, 100%); background: var(--panel); border: 1px solid var(--gold-dim); border-radius: 10px;
  padding: 22px 24px; box-shadow: 0 10px 50px rgba(0,0,0,0.7); max-height: 100%; overflow-y: auto;
}
.card h1 { font: 700 28px/1.15 Georgia, 'Times New Roman', serif; color: var(--gold); margin: 0 0 4px; }
.card .kicker { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--gold-dim); }
.card .framing { font: italic 16px/1.5 Georgia, serif; color: var(--dialogue); margin: 12px 0 14px; }
.card h3 { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold-dim); margin: 14px 0 6px; }
.card ul { margin: 0; padding-left: 18px; }
.card li { margin: 3px 0; }
.card .hint { color: var(--muted); font-size: 12px; }
.card .actions { margin-top: 18px; display: flex; justify-content: flex-end; }
.card .actions button { font-size: 15px; padding: 10px 22px; }
.card.victory h1 { color: #9fe0a8; }
.card.defeat h1 { color: #f39a8a; }
@media (max-width: 819px) {
  html, body { overflow-x: hidden; overflow-y: auto; height: auto; }
  #app { flex-direction: column; height: auto; min-height: 100%; padding: 16px; gap: 12px; }
  #board { flex: 0 0 auto; }
  #tileinfo { height: 76px; }
  #hud { flex: 0 0 auto; width: 100%; height: auto; overflow: visible; }
  .log-panel > div { height: 240px; flex: none; }
  #dialogue { bottom: 6px; padding: 8px 10px; }
  #dialogue .text { font-size: 14px; }
  .card { padding: 18px 16px; }
  .card h1 { font-size: 24px; }
}
`;
