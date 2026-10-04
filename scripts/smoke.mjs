// Browser smoke test: serves the production build with `vite preview`, plays
// the opening of a turn in headless Chromium at two laptop viewports
// (1280x720 and 1920x1080), fails on any console error or page scroll, and
// saves screenshots.
//
//   npm run smoke            (builds first)
//   SMOKE_OUT=/some/dir node scripts/smoke.mjs   (default: <os tmpdir>/lantern-smoke)
//   SMOKE_FULL=1 npm run smoke   also ends turns until the battle is decided
//                                and checks the result card and Play again
//                                (1280x720 pass only)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.SMOKE_OUT ?? join(tmpdir(), 'lantern-smoke');
const port = Number(process.env.SMOKE_PORT ?? 4319);
const url = `http://127.0.0.1:${port}/`;
mkdirSync(outDir, { recursive: true });

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

async function waitForServer(target, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(target);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not start at ${target}`);
}

function startPreview() {
  const vite = join(root, 'node_modules', '.bin', 'vite');
  const child = spawn(vite, ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  return child;
}

/** Collects console errors and uncaught exceptions for a page. */
function watchErrors(page, label, errors) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console.error: ${m.text()}`);
    if (m.type() === 'warning') log(`${label} console.warn: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
}

const waitIdle = (page, timeout = 30000) =>
  page.waitForFunction(() => window.__lantern && window.__lantern.started && !window.__lantern.locked, null, { timeout });

async function tileClient(page, x, y) {
  return page.evaluate(([tx, ty]) => window.__lantern.tileToClient(tx, ty), [x, y]);
}

/** Picks a rebel unit that can move (prefers Varek), returns its id and position. */
async function pickRebel(page) {
  return page.evaluate(() => {
    const s = window.__lantern.state;
    const rebels = s.units.filter((u) => u.faction === s.playerFaction && !u.statuses.includes('dueling'));
    const u = rebels.find((r) => r.character === 'varek') ?? rebels[0];
    return u ? { id: u.id, pos: u.pos } : null;
  });
}

async function playOpening(page, label, { domain = false } = {}) {
  const click = async (x, y) => {
    const c = await tileClient(page, x, y);
    await page.mouse.click(c.x, c.y);
  };

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#begin-btn', { timeout: 10000 });
  await page.screenshot({ path: join(outDir, `${label}-intro.png`) });
  await page.click('#begin-btn');
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(outDir, `${label}-banner.png`) });
  await waitIdle(page);
  // Let the opening banner fade.
  await page.waitForTimeout(1400);

  // Keyboard: Tab selects the next ready unit, Esc deselects.
  await page.keyboard.press('Tab');
  const tabSel = await page.evaluate(() => window.__lantern.selection.mode);
  await page.keyboard.press('Escape');
  const escSel = await page.evaluate(() => window.__lantern.selection.mode);
  if (tabSel !== 'unit' || escSel !== 'none') throw new Error(`${label}: Tab/Esc selection failed (${tabSel}, ${escSel})`);
  log(`${label}: Tab selects, Esc deselects`);

  const unit = await pickRebel(page);
  if (!unit) throw new Error(`${label}: no rebel unit to select`);
  await click(unit.pos.x, unit.pos.y);
  const sel = await page.evaluate(() => window.__lantern.selection);
  if (sel.mode !== 'unit' || sel.unitId !== unit.id) throw new Error(`${label}: selecting ${unit.id} failed (${JSON.stringify(sel.mode)})`);
  if (sel.moves.length === 0) throw new Error(`${label}: ${unit.id} has no reachable tiles`);
  log(`${label}: selected ${unit.id}, ${sel.moves.length} reachable tiles, ${sel.targets.length} targets`);
  // Hover a destination to show the path preview, then screenshot the highlights.
  const dest = [...sel.moves].sort((a, b) => a.y - b.y || Math.abs(a.x - unit.pos.x) - Math.abs(b.x - unit.pos.x))[0];
  const destClient = await tileClient(page, dest.x, dest.y);
  await page.mouse.move(destClient.x, destClient.y);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(outDir, `${label}-selected.png`), fullPage: false });

  await click(dest.x, dest.y);
  await waitIdle(page);
  const moved = await page.evaluate((id) => window.__lantern.state.units.find((u) => u.id === id)?.pos, unit.id);
  if (!moved || moved.x !== dest.x || moved.y !== dest.y) {
    throw new Error(`${label}: ${unit.id} did not move to (${dest.x},${dest.y}); now at ${JSON.stringify(moved)}`);
  }
  log(`${label}: ${unit.id} moved to (${dest.x},${dest.y})`);

  if (domain) {
    const btn = page.locator('#hud button.domain');
    if ((await btn.count()) > 0) {
      await btn.first().click();
      await page.waitForTimeout(450);
      await page.screenshot({ path: join(outDir, `${label}-domain-pulse.png`) });
      await waitIdle(page);
      log(`${label}: Domain activated`);
    }
  }
  await page.screenshot({ path: join(outDir, `${label}-moved.png`) });

  // End the turn (button), then wait for the AI phase to run and hand back control.
  const roundBefore = await page.evaluate(() => window.__lantern.state.round);
  // End the turn with the E key.
  await page.keyboard.press('e');
  await page.waitForFunction(
    (r) => {
      const l = window.__lantern;
      return l.state.round === r + 1 && l.state.phase === 'player' && !l.locked;
    },
    roundBefore,
    { timeout: 120000 },
  );
  await page.waitForTimeout(900);
  log(`${label}: AI phase finished, round ${roundBefore + 1}`);
  await page.screenshot({ path: join(outDir, `${label}-round2.png`) });

  // Damage preview: find a ready rebel with an attack target and hover it.
  const ready = await page.evaluate(() => {
    const s = window.__lantern.state;
    return s.units.filter((u) => u.faction === s.playerFaction && !u.hasActed).map((u) => ({ id: u.id, pos: u.pos }));
  });
  for (const r of ready) {
    await click(r.pos.x, r.pos.y);
    const sel = await page.evaluate(() => window.__lantern.selection);
    if (sel.mode !== 'unit' || sel.unitId !== r.id || sel.targets.length === 0) continue;
    const t = sel.targets[0];
    const c = await tileClient(page, t.pos.x, t.pos.y);
    await page.mouse.move(c.x, c.y);
    await page.waitForTimeout(200);
    const tip = await page.evaluate(() => {
      const el = document.getElementById('tooltip');
      return el && el.style.display !== 'none' ? el.textContent : null;
    });
    if (!tip || !/dmg/.test(tip)) throw new Error(`${label}: no damage tooltip over ${t.id} (got ${JSON.stringify(tip)})`);
    log(`${label}: ${r.id} -> ${t.id} tooltip "${tip}"`);
    await page.screenshot({ path: join(outDir, `${label}-tooltip.png`) });
    break;
  }
}

/** Ends every turn until the game is over; screenshots the First Bell and the result card. */
async function playToEnd(page, label) {
  let bellShot = false;
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ over: window.__lantern.state.gameOver, round: window.__lantern.state.round }));
    if (st.over) break;
    const firstBell = await page.evaluate(() => window.__lantern.state.bells.find((b) => b.id === 'firstBell')?.round ?? -1);
    await page.click('#hud button[data-cmd="endTurn"]');
    if (!bellShot && st.round === firstBell - 1) {
      bellShot = true;
      // The bell rings as the next round starts; its banner follows the phase banner.
      await page.waitForFunction((r) => window.__lantern.state.round === r, firstBell, { timeout: 180000 });
      await page.waitForTimeout(1300);
      await page.screenshot({ path: join(outDir, `${label}-first-bell.png`) });
    }
    await page.waitForFunction(
      () => window.__lantern.state.gameOver || (window.__lantern.state.phase === 'player' && !window.__lantern.locked),
      null,
      { timeout: 180000 },
    );
  }
  await page.waitForSelector('#again-btn', { timeout: 15000 });
  const result = await page.evaluate(() => window.__lantern.state.result);
  log(`${label}: battle over in round ${await page.evaluate(() => window.__lantern.state.round)}: ${result?.result} (${result?.reason})`);
  await page.screenshot({ path: join(outDir, `${label}-result.png`) });
  await page.click('#again-btn');
  await waitIdle(page);
  const fresh = await page.evaluate(() => ({ round: window.__lantern.state.round, over: window.__lantern.state.gameOver }));
  if (fresh.round !== 1 || fresh.over) throw new Error(`${label}: Play again did not restart (${JSON.stringify(fresh)})`);
  log(`${label}: Play again restarted the battle`);
}

async function main() {
  const server = startPreview();
  const errors = [];
  let browser;
  try {
    await waitForServer(url);
    log(`preview server up at ${url}`);
    browser = await chromium.launch();

    const viewports = [
      { label: 'laptop-1280', width: 1280, height: 720, full: true },
      { label: 'laptop-1920', width: 1920, height: 1080, full: false },
    ];
    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      watchErrors(page, vp.label, errors);
      await playOpening(page, vp.label, { domain: true });
      const scroll = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }));
      if (scroll.x > 0) errors.push(`${vp.label}: page scrolls horizontally by ${scroll.x}px`);
      if (scroll.y > 0) errors.push(`${vp.label}: page scrolls vertically by ${scroll.y}px`);
      if (vp.full && process.env.SMOKE_FULL) await playToEnd(page, vp.label);
      await ctx.close();
    }
  } catch (e) {
    errors.push(`smoke flow failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  } finally {
    await browser?.close();
    server.kill();
  }
  log(`screenshots in ${outDir}`);
  if (errors.length > 0) {
    console.error(`[smoke] FAILED with ${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  log('OK: no console errors');
}

main();
