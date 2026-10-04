// Launcher for the TypeScript balance simulator, with no extra dependencies:
// Vite's module runner transpiles scripts/sim/main.ts and its imports.
// Usage: npm run sim -- [--seeds N] [--strategy a,b] [--trace] [--runs] [--json]
import { runnerImport } from 'vite';

const { module } = await runnerImport(new URL('./main.ts', import.meta.url).pathname, {
  configFile: false,
  logLevel: 'silent',
});
module.main(process.argv.slice(2));
