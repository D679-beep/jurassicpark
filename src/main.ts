// Wires content -> engine -> ui.
import { chooseAiAction } from './ai';
import { prologueIntro, prologueScenario } from './content';
import { mountGame } from './ui';

const canvas = document.getElementById('game');
const hud = document.getElementById('hud');

if (canvas instanceof HTMLCanvasElement && hud) {
  mountGame({
    canvas,
    hud,
    scenario: prologueScenario,
    chooseAiAction,
    introText: prologueIntro,
    skipIntro: new URLSearchParams(window.location.search).has('skipIntro'),
  });
} else {
  console.error('The Lantern Crown: #game canvas or #hud element missing');
}
