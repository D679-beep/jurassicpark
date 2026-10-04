// Frame-time measurement: serves the production build with `vite preview`,
// drives the game in headless Chromium and records requestAnimationFrame
// intervals (inside the page, via performance.now()) for three scenarios:
//   domain  - Varek's Domain is active (5 s)
//   ai      - the AI phase after End Turn (5 s; reports how long it stayed locked)
//   idle    - player turn, nothing happening (5 s)
//
//   npm run perf             (builds first)
//   PERF_VIEWPORT=1280x720 npm run perf   (default 1920x1080, deviceScaleFactor 1)
//   PERF_OUT=/some/file.json npm run perf (also save the results as JSON)
//   PERF_MS=5000, PERF_PORT=4320          (measurement window / preview port)
//
// Exits non-zero only on page errors (console.error / uncaught exceptions) or
// if the flow itself fails.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PERF_PORT ?? 4320);
const url = `http://127.0.0.1:${port}/`;
const windowMs = Number(process.env.PERF_MS ?? 5000);
const viewportEnv = process.env.PERF_VIEWPORT ?? '1920x1080';
const vpMatch = /^(\d+)x(\d+)$/.exec(viewportEnv.trim());
if (!vpMatch) {
  console.error(`[perf] bad PERF_VIEWPORT "${viewportEnv}" (expected WIDTHxHEIGHT, e.g. 1280x720)`);
  process.exit(2);
}
const viewport = { width: Number(vpMatch[1]), height: Number(vpMatch[2]) };

const log = (msg) => console.log(`[perf] ${msg}`);

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

const waitIdle = (page, timeout = 30000) =>
  page.waitForFunction(() => window.__lantern && window.__lantern.started && !window.__lantern.locked, null, { timeout });

/** Picks a rebel unit (prefers Varek), returns its id and position. */
async function pickRebel(page) {
  return page.evaluate(() => {
    const s = window.__lantern.state;
    const rebels = s.units.filter((u) => u.faction === s.playerFaction && !u.statuses.includes('dueling'));
    const u = rebels.find((r) => r.character === 'varek') ?? rebels[0];
    return u ? { id: u.id, pos: u.pos, character: u.character } : null;
  });
}

/**
 * Records rAF intervals in the page for `ms` milliseconds. Also samples
 * window.__lantern.locked on every frame so the caller can tell how long the
 * input lock (the AI phase) lasted within the window.
 */
function measure(page, ms) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const intervals = [];
        let lockedMs = 0;
        let last = performance.now();
        const begin = last;
        const tick = (now) => {
          const dt = now - last;
          intervals.push(dt);
          if (window.__lantern?.locked) lockedMs += dt;
          last = now;
          if (now - begin >= duration) resolve({ intervals, lockedMs, elapsedMs: now - begin });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

function pct(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function stats(name, m) {
  // Drop the first interval: it spans from the evaluate call to the first frame.
  const iv = m.intervals.slice(1);
  const sorted = [...iv].sort((a, b) => a - b);
  const n = iv.length;
  const sum = iv.reduce((a, b) => a + b, 0);
  const r = (x) => Math.round(x * 100) / 100;
  return {
    scenario: name,
    frames: n,
    meanMs: r(sum / n),
    p50Ms: r(pct(sorted, 50)),
    p95Ms: r(pct(sorted, 95)),
    p99Ms: r(pct(sorted, 99)),
    maxMs: r(sorted[n - 1]),
    pctOver20ms: r((iv.filter((x) => x > 20).length / n) * 100),
    elapsedMs: Math.round(m.elapsedMs),
    lockedMs: Math.round(m.lockedMs),
  };
}

function printStats(s) {
  console.log(
    `[perf] ${s.scenario.padEnd(7)} frames=${String(s.frames).padStart(5)}  mean=${s.meanMs.toFixed(2)}ms  p50=${s.p50Ms.toFixed(2)}  p95=${s.p95Ms.toFixed(2)}  p99=${s.p99Ms.toFixed(2)}  max=${s.maxMs.toFixed(2)}  >20ms=${s.pctOver20ms.toFixed(1)}%`,
  );
}

async function main() {
  const server = startPreview();
  const errors = [];
  const results = [];
  const notes = [];
  let browser;
  try {
    await waitForServer(url);
    log(`preview server up at ${url}; viewport ${viewport.width}x${viewport.height}, ${windowMs} ms per scenario`);
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#begin-btn', { timeout: 10000 });
    await page.click('#begin-btn');
    await waitIdle(page);
    await page.waitForTimeout(1400); // let the opening banner fade

    // Select Varek and activate his Domain.
    const unit = await pickRebel(page);
    if (!unit) throw new Error('no rebel unit to select');
    if (unit.character !== 'varek') notes.push(`Varek not found; used ${unit.character}`);
    const c = await page.evaluate(([x, y]) => window.__lantern.tileToClient(x, y), [unit.pos.x, unit.pos.y]);
    await page.mouse.click(c.x, c.y);
    const sel = await page.evaluate(() => window.__lantern.selection);
    if (sel.mode !== 'unit' || sel.unitId !== unit.id) throw new Error(`selecting ${unit.id} failed`);
    const btn = page.locator('#hud button.domain');
    // The HUD re-renders asynchronously after the selection, so wait for the button.
    try {
      await btn.first().waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      throw new Error(`no Domain button (#hud button.domain) for ${unit.id}`);
    }
    await btn.first().click();
    await page.waitForTimeout(100);
    const domains = await page.evaluate(() => window.__lantern.state.domains.length);
    if (domains === 0) throw new Error('Domain did not activate (state.domains is empty)');
    log(`${unit.id} Domain active (${domains} active domain(s))`);

    // 1. Domain active (the window starts right at activation, so it includes the
    // activation animation; lockedMs in the JSON shows how long that lasted).
    // Deselect first so only the domain overlay is drawn.
    await page.keyboard.press('Escape');
    results.push(stats('domain', await measure(page, windowMs)));
    printStats(results.at(-1));

    // 2. End Turn, measure the AI phase.
    await page.click('#hud button[data-cmd="endTurn"]');
    const m = await measure(page, windowMs);
    const ai = stats('ai', m);
    results.push(ai);
    printStats(ai);
    log(`ai: input locked for ${ai.lockedMs} ms of the ${ai.elapsedMs} ms window${ai.lockedMs < ai.elapsedMs * 0.95 ? ' (AI phase ended before the window did)' : ''}`);
    await page.waitForFunction(() => window.__lantern.state.phase === 'player' && !window.__lantern.locked, null, { timeout: 120000 });
    await page.waitForTimeout(1500); // let banners/animations settle

    // 3. Idle player turn, nothing happening (no input, no animation; any domain still active is reported).
    log(`idle: ${await page.evaluate(() => window.__lantern.state.domains.length)} domain(s) still active, round ${await page.evaluate(() => window.__lantern.state.round)}`);
    results.push(stats('idle', await measure(page, windowMs)));
    printStats(results.at(-1));

    await ctx.close();
  } catch (e) {
    errors.push(`perf flow failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  } finally {
    await browser?.close();
    server.kill();
  }

  const summary = { viewport: `${viewport.width}x${viewport.height}`, windowMs, notes, results };
  console.log(`[perf] summary ${JSON.stringify(summary)}`);
  if (process.env.PERF_OUT) {
    mkdirSync(dirname(join(process.cwd(), process.env.PERF_OUT)), { recursive: true });
    writeFileSync(process.env.PERF_OUT, JSON.stringify(summary, null, 2) + '\n');
    log(`saved ${process.env.PERF_OUT}`);
  }
  if (errors.length > 0) {
    console.error(`[perf] FAILED with ${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
}

main();
