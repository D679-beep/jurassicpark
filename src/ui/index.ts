// UI: canvas renderer, input handling, HUD and event log; the only layer that touches the DOM.
// The DOM-free modules (layout, eventText, selection, animation, hudModel,
// names, aiDriver) are also exported for tests and tooling.
export { mountGame, GameController, type MountOptions } from './controller';
export * from './layout';
export * from './eventText';
export * from './selection';
export * from './animation';
export * from './hudModel';
export * from './names';
export * from './aiDriver';
