# The Lantern Crown

A browser-based, turn-based grid tactics game built with TypeScript, Vite and HTML5 Canvas 2D, with no game engine and no runtime dependencies. The current target is the prologue slice: the Night of Ashen Lanterns coup battle, played as the Rebels against an AI-controlled Loyalist side.

## How to play

You command the Rebels on the Night of Ashen Lanterns. Varek and the Ashen Wolves have slipped into the palace of Calderon, and the Emperor must be dead before Dawn. Each round is your phase, then the Loyalist AI's phase. Every unit gets one move and one action per turn (attack, skill, interact or wait).

**The bell clock.** The night is timed by three bells: the First Bell (round 5) brings the City Watch, the Second Bell (round 9) brings the Dawn Lantern knights, and Dawn (round 13) brings the Southern Legion. If the Emperor is still alive at Dawn, you lose. The HUD shows the next bell and any upcoming reinforcements.

**Objectives**

- Required: kill Emperor Halden. Only Varek, standing beside him, can Confront him.
- Optional: kill Crown Prince Elian (sealed in the Wellspring Hall until the ward anchors fall or the Second Bell rings, and he can escape through the servants' tunnel).
- Optional: imprison Princess Mira (weaken her with Kaela, then Capture; she flees toward her escape exit, and a Wolf's hit can kill her).
- Bonus: seize the bell tower (end your phase with a rebel inside and no loyalist), which delays the remaining bells by 2 rounds.
- Bonus: burn the centre and east canal bridges, which delays the Second Bell knights by 2 rounds.

You also lose if Varek or Kaela dies.

**Ascendants** (Varek, Grimm, Orsa, Elian)

- Only an Ascendant can really hurt an Ascendant: damage from anyone else is capped at 1 per hit.
- Ascendants deal 50% more damage to non-Ascendants.
- Each has one Domain per battle, a radius-3 area lasting 3 rounds (Varek: Tempest, Grimm: Pyre, Orsa: Bulwark, Elian: Sanctuary). Afterwards they are Drained for the rest of the battle (-2 ATK, -1 move).
- Grimm and Orsa start locked in a duel in the Feast Hall. If Grimm leaves, Orsa is freed and heads for the throne.

## Controls

- Mouse or touch: click or tap a unit to select it, a highlighted tile to move, and an enemy to attack. On touch, the first tap on a target shows the damage forecast and the second tap attacks.
- Tab / Shift+Tab: select the next / previous ready unit.
- Esc: clear the selection and dismiss dialogue.
- E: end your turn.
- W: wait with the selected unit.

## Development

```sh
npm install
npm run dev        # start the dev server
npm test           # run the unit tests
npm run typecheck  # tsc --noEmit
npm run build      # typecheck and build to dist/
npm run smoke      # build, then play a turn in headless Chromium (Playwright) and save screenshots
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on every push and pull request. It does not run the smoke test.

## Docs

- [Story](docs/story.md)
- [Prologue slice design](docs/design/prologue-slice.md)
