// CLI for the balance simulator. Run with `npm run sim -- [options]`:
//   --seeds N          seeds per strategy (default 20)
//   --base S           first seed (default 1; seeds step by 7919)
//   --strategy a,b     only these strategies (default: all)
//   --trace            print a per-round event log of the first seed
//   --watch a,b        unit ids shown in the trace (default: the named characters)
//   --runs             print one line per run
//   --json             print the summaries as JSON
//   --variant name     play a scenario variant (v0.1 = untuned, no-duel, ...; see variants.ts)
import type { GameEvent, GameState } from '../../src/engine';
import { runGame, runMany, seedList, summarize, type RunResult, type Summary } from './harness';
import { STRATEGIES } from './strategies';
import { scenarioVariant } from './variants';

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const fmt = (x: number | null, d = 1): string => (x === null ? '-' : x.toFixed(d));
const pct = (x: number): string => `${Math.round(x * 100)}%`;

function table(rows: Summary[]): string {
  const head = ['strategy', 'win', 'confront', 'conf rnd (min-max)', 'Elian K/E', 'Elian esc rnd', 'Mira C/E/D', 'Mira esc rnd', 'both', 'losses', 'Grimm dead (rnd)', 'Orsa dead (rnd, Grimm hp)', 'bell/bridges'];
  const body = rows.map((r) => [
    r.strategy,
    pct(r.winRate),
    pct(r.confrontRate),
    r.confrontMean === null ? '-' : `${fmt(r.confrontMean)} (${r.confrontMin}-${r.confrontMax})`,
    `${r.elianKilled}/${r.elianEscaped}`,
    fmt(r.elianEscapeMean),
    `${r.miraCaptured}/${r.miraEscaped}/${r.miraDead}`,
    fmt(r.miraEscapeMean),
    String(r.bothOptionals),
    fmt(r.lossesMean),
    `${r.grimmDied} (${fmt(r.grimmDiedMean)})`,
    `${r.orsaDied} (${fmt(r.orsaDiedMean)}, ${fmt(r.grimmHpAtOrsaDeath, 0)})`,
    `${r.bellTower}/${r.bridges}`,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (cells: string[]): string => '| ' + cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ') + ' |';
  return [line(head), '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|', ...body.map(line)].join('\n');
}

function describeEvent(e: GameEvent): string | null {
  switch (e.type) {
    case 'died':
      return `${e.unitId} died (${e.cause}${e.killerId ? ` by ${e.killerId}` : ''})`;
    case 'escaped':
      return `${e.unitId} escaped`;
    case 'captured':
      return `${e.unitId} captured`;
    case 'objectDestroyed':
      return `${e.objectId} destroyed by ${e.byUnitId}`;
    case 'domainActivated':
      return `${e.unitId} ${e.domain} at (${e.center.x},${e.center.y})`;
    case 'sealBroken':
      return `seal broken (${e.reason})`;
    case 'duelEnded':
      return `duel ended (${e.reason})`;
    case 'bellRang':
      return `${e.name}`;
    case 'bellsDelayed':
      return `bells delayed (${e.reason})`;
    case 'bridgeBurned':
      return `${e.bridgeId} burned`;
    case 'gameOver':
      return `GAME OVER ${e.result}: ${e.reason}`;
    default:
      return null;
  }
}

export function main(argv: string[]): void {
  const n = Number(arg(argv, '--seeds') ?? 20);
  const only = arg(argv, '--strategy')?.split(',');
  const strategies = STRATEGIES.filter((s) => !only || only.includes(s.name));
  const seeds = seedList(n, Number(arg(argv, '--base') ?? 1));
  const variant = arg(argv, '--variant') ?? 'current';
  const scenario = scenarioVariant(variant);
  if (argv.includes('--trace')) {
    for (const strat of strategies) {
      console.log(`\n=== trace: ${strat.name} seed ${seeds[0]} ===`);
      runGame(strat, seeds[0]!, {
        scenario,
        onPhase: (s: GameState, events: GameEvent[]) => {
          const lines = events.map(describeEvent).filter((x): x is string => x !== null);
          const key = (arg(argv, '--watch')?.split(',') ?? ['varek', 'kaela', 'grimm', 'orsa', 'mira', 'elian'])
            .map((id) => {
              const u = s.units.find((x) => x.id === id);
              return u ? `${id}@${u.pos.x},${u.pos.y}:${u.hp}` : `${id}:-`;
            })
            .join(' ');
          console.log(`r${s.round} ${s.phase} | ${key}`);
          for (const l of lines) console.log(`    ${l}`);
        },
      });
    }
    return;
  }
  const t0 = Date.now();
  const summaries: Summary[] = [];
  const all: RunResult[] = [];
  for (const strat of strategies) {
    const runs = runMany(strat, seeds, { scenario });
    all.push(...runs);
    summaries.push(summarize(strat.name, runs));
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }
  console.log(`Prologue balance sim (${variant}): ${n} seeds per strategy (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  console.log(table(summaries));
  console.log('\nOutcomes:');
  for (const s of summaries) console.log(`  ${s.strategy}: ${Object.entries(s.reasons).map(([k, v]) => `${v}x ${k}`).join('; ')}`);
  if (argv.includes('--runs')) {
    console.log('\nRuns:');
    for (const r of all) {
      console.log(
        `  ${r.strategy} seed=${r.seed} ${r.result} r${r.endRound} confront=${r.confrontRound ?? '-'} elian=${r.elian}@${r.elianRound ?? '-'} mira=${r.mira}@${r.miraRound ?? '-'} lost=[${r.lost.join(',')}] grimm=${r.grimmDiedRound ?? '-'} orsa=${r.orsaDiedRound ?? '-'} seal=${r.sealBrokenRound ?? '-'}`,
      );
    }
  }
}
