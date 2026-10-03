// TEMPORARY placeholder until the real prologue scenario lands: reuses the engine test fixture.
import type { ScenarioDef } from '../engine';
import { miniPrologue } from '../../tests/engine/fixtures/miniPrologue';

export const prologueScenario: ScenarioDef = miniPrologue();
