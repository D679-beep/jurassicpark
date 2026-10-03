# The Lantern Crown — Game Plan (v0.1)

*Companion to `docs/story.md` (story draft v0.2). This plan covers what kind of game to make, how each system works, how the story is told through play, what it looks and sounds like, and how to build it. New names introduced here are placeholders.*

---

## 1. The Pitch in One Paragraph

**The Lantern Crown** is a story-driven **tactical RPG with a war-table layer**, played as two mirrored campaigns. It opens with a **timed, city-wide coup battle**: one night, lit only by lanterns, in which every move costs minutes and every temple bell brings the enemy's reinforcements closer. Afterwards the coup becomes a civil war. You move your few **Ascendants**, living strategic weapons, across a war map where committing one to a battle leaves every other front exposed. In grid battles, Domains rewrite the battlefield. Between battles you build bonds, make choices that shape your character's own **Vow**, and gradually uncover the man who arranged the whole war. Then you play the same night from the other side and find out what you missed.

### Recommended answer to Open Question 1 (genre)
**Tactical RPG (grid, turn-based) + strategic war map + visual-novel story scenes.**
- The coup night and Ascendant deployment are the two strongest ideas in the story, and both are strategy ideas. A visual novel or action RPG would waste them.
- Comparable games, for tone and scope: *Triangle Strategy* (branching politics with a tactics core), *Fire Emblem: Three Houses* (bonds, split campaigns), *The Banner Saga* (war, attrition, painterly art), *Into the Breach* (readable, telegraphed tactics), *Invisible Inc.* (time pressure as the core tension).

---

## 2. Design Pillars

Every feature should serve at least one of these. Cut anything that serves none.

1. **Every bell matters.** Time is the main resource. On coup night it is literal, measured in minutes. In the war it is the Wellspring growing unstable, the Hollowed advancing, and the seasons turning.
2. **Presence is power.** An Ascendant decides the battle they are at, and only that one. The interesting decision is never "use the big gun". It is "*where* do I put the big gun, and what do I give up?"
3. **Kindness has a cost, and so does cruelty.** Mercy and ruthlessness are mechanics, not dialogue flavour. Spared enemies come back, and the way they come back depends on what you did.
4. **Two sides of one story.** Each campaign holds answers to the other campaign's mysteries. The second playthrough is a different experience, not a repeat.
5. **You write your own rule.** In Act III the player's Vow, assembled from their choices, becomes a hard gameplay rule for the rest of the game.

---

## 3. The Four Gameplay Layers

```
 ┌──────────────────────────────────────────────────────────────┐
 │  META LAYER        Cross-campaign "Echoes", Mira's Trust,    │
 │                    True Ending unlock                        │
 ├──────────────────────────────────────────────────────────────┤
 │  WAR TABLE         Seasons, regions, Ascendant tokens,       │
 │  (Acts I–III)      supplies, morale, Hollowed pressure       │
 ├──────────────────────────────────────────────────────────────┤
 │  NIGHT MAP         Coup night only: districts of Calderon,   │
 │  (Prologue)        the Bell Clock, off-screen fronts         │
 ├──────────────────────────────────────────────────────────────┤
 │  TACTICAL BATTLE   Grid, height, light/dark, Domains, duels  │
 ├──────────────────────────────────────────────────────────────┤
 │  CAMP & STORY      Scenes, bonds, choices, letters, Ledger   │
 └──────────────────────────────────────────────────────────────┘
```

**The loop at each scale**
- **Moment to moment (seconds):** read enemy intents, position, decide whether to kill or spare, spend mana.
- **Battle (20–40 min):** complete objectives before a clock runs out (bells, dawn, Domain duration, Hollowed arrival).
- **Chapter (60–90 min):** war-table turn → 1–2 battles → camp scenes → a choice with consequences.
- **Campaign (20–25 h each):** rise from Kindled to Radiant to Ascendant, gather allies, reach an ending.
- **Meta (both campaigns, ~45–55 h):** carry Echoes across campaigns, expose Sereth twice, reach *The Third Lantern*.

---

## 4. Prologue: The Night of Ashen Lanterns (the vertical slice)

This is the game's showcase, its demo, and its tutorial. Build it first and build it best.

### 4.1 Before midnight (≈25 min, shared)
| Beat | Play | What it teaches / sets up |
|---|---|---|
| **Cold open** | 40 seconds in-engine: a single lantern goes out, then the whole city goes dark in one wave, and a bell tolls. Cut to *"Six hours earlier."* | Shows the stakes and the visual hook immediately. |
| **The Festival of Lanterns** | A small explorable hub: market stalls, lantern-lighting, people to talk to. | Lets the player get to know Calderon before it burns. Every NPC met here can appear later, alive or in the Ledger. |
| **Exhibition bout** | Aren spars with **Elian** in front of the crowd. Elian never lands a finishing strike. | Teaches basic combat. Foreshadows Elian's Vow. |
| **Frontier arrival** | Kaela rides in with the Ashen Wolves. Townsfolk turn away from their scarred armour. | Teaches movement and terrain. Shows how the capital treats its soldiers. |
| **The Petition** | Story scene. Varek begs and the Emperor refuses, gently. Sereth follows Varek out. | Lays out the central argument of the game. |
| **Hidden setup** | An old servant ("Old Brannoc", placeholder) mentions a forgotten passage behind the throne. Few players will notice. | Seeds the hidden Emperor-saving route. |
| **Faction choice** | Two lanterns on a balcony rail. Light one (Aren) or snuff one out (Kaela). | Sets the side for coup night and the rest of the campaign. |

### 4.2 The Night Map
At midnight the camera pulls up to a top-down **Night Map** of Calderon's inner city, drawn like a lantern-lit model of the city.

**Districts (nodes):** Gate of Dawn · Feast Hall · Throne Hall · Wellspring Hall · Princess's Tower · Bell Tower · Canal Bridges · River Gate · Servants' Tunnels · Conclave Library.

**The Bell Clock**
- A real-time-to-turn conversion: **one tactical turn = 3 minutes of night.** Moving between adjacent districts costs 10–20 minutes.
- Midnight to dawn is 6 hours, about 120 turns in all. A player fits in **4–6 battles**, and cannot do everything. That scarcity is the design.
- A large diegetic bell tower sits in the corner of the screen. Its shadow moves. A soft chime sounds every quarter hour, and a full toll plays at each Bell.
- **Off-screen fronts:** other squads (the Ashen Wolves' companies, City Watch detachments) are tokens fighting their own simulated battles. Districts change hands while you are elsewhere, so you have to keep looking back at the map.

**Commanding Ascendants on the Night Map.** Once per Bell the player gives a **directive** to their side's free Ascendant:
- *Rebel:* Grimm pins Orsa in the Feast Hall (default) **or** burns the Canal Bridges (delays the Dawn Lanterns, but frees Orsa early and sets part of the city on fire. Civilian casualties go into the Ledger).
- *Loyalist:* Orsa holds the Feast Hall **or**, once freed, raises a *Bulwark* at a chosen district, which then cannot be taken until she leaves it.

### 4.3 Coup night battles

**Rebel (Kaela)**
| District | Battle | Twist |
|---|---|---|
| Gate of Dawn | Seize the inner gate in the dark before the alarm is raised. | Stealth-tactics: units in darkness are hidden. Killing a lantern-bearer before they light a beacon keeps the gate quiet. |
| Bell Tower | Silence the bells (delays First Bell by 20 min). | Vertical map. Bell-ringers are civilians. Choose whether to spare or kill them, and it is tracked. |
| Canal Bridges | Burn the bridges (delays Second Bell). | Fire spreads every turn and can cut off your own retreat. |
| Throne Hall | Escort Varek to the Emperor. | The Emperor does not fight. The fight is against his last 30 guards, who choose to die for him. |
| Wellspring Hall | Help Varek reach Elian before he breaks the seal. | The seal has 3 ward anchors. Loyalist AI tries to break them. Every anchor that falls makes Elian stronger. |
| Princess's Tower | Capture Mira **alive**. | Mira fights back with Radiant barriers. Any attack that would kill her is automatically turned into a subdue, but a subdued Mira must be carried, which halves your move. **First meeting with Aren.** |

**Loyalist (Aren)**
| District | Battle | Twist |
|---|---|---|
| Wellspring Hall | Destroy Sereth's 3 ward anchors. | The anchors carry **Conclave sigils**, the first clue to Sereth. An observant player can pick one up as evidence. |
| Feast Hall | Free Orsa. | The battle takes place inside an Ascendant duel: Pyre spreads fire across the hall while Bulwark walls rise and fall. You fight in the gaps. |
| Bell Tower | Ring the alarm early (brings First Bell forward by 20 min). | The mirror of the Rebel mission. The same map is now a defence. |
| River Gate | Open it for the Dawn Lanterns. | A lock puzzle under pressure. Gate winches take 3 turns of channelling. |
| Princess's Tower | Reach Mira before Kaela does. | A mirror battle. It ends in the first Aren vs Kaela duel. |
| Servants' Tunnels → Throne Hall | **Hidden route:** reach the Emperor before Varek. | Requires Brannoc's hint, Orsa freed before First Bell, and the tunnels cleared in under 30 turns. Success leads to *"Dawn Unbroken."* |

### 4.4 Ending the night
At dawn the Southern Legion's arrival is shown as the map literally turning from night to day: shadows shorten, lanterns gutter out, and gold light reaches across the rooftops district by district. A results screen written as an **Imperial Chronicle entry** records the outcomes (Emperor, Elian, Mira, civilians, named dead) and states which campaign variant the player is now on.

---

## 5. Tactical Battle System

### 5.1 Fundamentals
- **Grid on 3D dioramas**, with height, facing, and destructible props (market stalls, carts, lantern posts, bridges).
- **Telegraphed enemy intents** for important actions, as in *Into the Breach*: big attacks show their target tile a turn ahead. This keeps the game readable while the clock is ticking.
- **Squad size:** 4–6 player units in most battles, plus guests (Ascendants, NPCs) who have their own AI or limited player control.

### 5.2 Light and darkness (signature mechanic, coup night and night missions)
- Every tile is **Lit**, **Dim**, or **Dark**. Lanterns, fires, and light-affinity skills light tiles.
- Units in Dark are hidden from enemies unless adjacent to them. Attacking from Dark grants **Ambush** (+crit, no counterattack).
- Rebels douse lanterns. Loyalists light them. On coup night, darkness is the fog of war.
- **Dawn creeps in from the east edge of each map** as the night goes on. Late in the night, cover disappears, and the visuals themselves tell the Rebel player that time is running out.

### 5.3 The three ranks as three skill layers
The skill bar grows over the campaign, so the game gets mechanically bigger as the story escalates.

| Rank | Unlocks | Feel |
|---|---|---|
| **Kindled** | Mana Edge (empower next strike), Surge (extra move), Endure (survive a lethal hit once per battle) | Close-range brawling. Positioning matters most. |
| **Radiant** | Ranged strikes, barriers, healing, **one affinity** (chosen at rank-up and tied to story choices) | Area control and elemental combos. |
| **Ascendant** | **Domain** plus the Vow rule | Changes how the whole battlefield behaves. |

### 5.4 Affinity interactions (combo system)
| | Effect on terrain | Combo |
|---|---|---|
| **Flame** | Wooden tiles ignite; fire spreads each turn | Flame + Storm wind = fire carried 3 tiles downwind |
| **Frost** | Water tiles freeze into walkable ice | Frost on a canal = a new bridge; Flame melts it and drowns whoever is standing on it |
| **Storm** | Water and metal conduct | Storm into a wet or armoured enemy group chains between them |
| **Stone** | Raise or lower tiles; create cover | Stone wall + Flame = a contained burn zone |
| **Light** | Lights tiles; heals; reveals hidden units | Light breaks Ambush and reveals Sereth's hidden effects |
| **Void** (enemy only) | Suppresses mana in an area | Turns off combos. Sudden, frightening. |

### 5.5 Kill, subdue, or let flee (mercy as mechanics)
- Every lethal attack can be switched to **Subdue** (−30% damage; the target is downed rather than killed).
- Enemies whose morale breaks **rout** and run for the map edge. You can cut them down, which ends their threat and moves your track towards Resolve/Iron, or let them go, which moves it towards Mercy/Honor.
- **Spared enemies have a future.** They go into a "Spared" register. Later some return as recruits, informants, or refugees who shelter you, and some come back as better-trained enemies who remember your face. The game should show both outcomes plainly.
- **Elian's Vow** makes all his attacks Subdue automatically. **Varek's Vow** gives him "Storm Fury" when an ally adjacent to him falls, and if three allies under his protection die in one battle he must retreat or risk cracking his core.

### 5.6 Morale (Nerve)
- Each unit has **Nerve**. Allied deaths, enemy Domains, and fire lower it. Ascendant arrivals, banners, and leader speeches raise it.
- **Ascendant shock:** when an Ascendant enters a battle, every enemy unit takes a Nerve check. When one falls, their whole side does.

### 5.7 Domains
A Domain is a once-per-battle ultimate that **changes the map for 3 turns**, then leaves its Ascendant **Exhausted** on the war table for 1–2 seasons.

| Domain | Owner | Map effect | Visual and audio |
|---|---|---|---|
| **Sanctuary** | Elian | Allies regenerate each turn; enemy damage is halved; nobody can die inside it, enemies included | A golden dome, falling motes of light, a choir chord held throughout |
| **Bulwark** | Orsa | Stone walls rise on chosen lines and nothing can pass them; allies inside have doubled defence | The ground heaves, the camera shakes, low drums |
| **Tempest** | Varek | Random lightning on telegraphed tiles; wind pushes every unit 1 tile each turn; ranged attacks are disabled | The screen goes violet-white with rain streaks and distorted thunder |
| **Pyre** | Grimm | Every turn fire spreads 2 tiles from Grimm; buildings collapse | Orange glow over everything, ash falling, a heat-haze shader |
| **Silence** | Sereth | **All mana abilities are disabled in a large radius**: no skills, no Domains, no combos | **The screen drains to greyscale, the music stops, and the UI skill bar visibly greys out.** The player feels the Domain as much as they see it. |

**Domain Clash.** When two Domains overlap, the battle pauses and a short **Clash** begins: three rounds in which each Ascendant chooses *Press*, *Hold*, or *Yield*, and each choice is coloured by their Vow. The winner's Domain covers the overlap. This is where brother fights brother in the Wellspring Hall.

### 5.8 Rival Duels (Aren vs Kaela)
A separate 1v1 system used for the rivalry encounters (the Tower, Act I and II meetings, the palace walls).
- **Blade Reading:** each exchange, the rival shows a **stance tell**. You choose *Strike*, *Feint*, *Guard*, or *Burst* (spend mana). A correct read lands a hit. A wrong one exposes you.
- **The rival learns.** Each duel tracks your habits. If you always Feint after a Guard, the rival starts punishing it.
- **You learn too, across campaigns.** Having played Kaela, you know her tells from the inside. The Loyalist campaign's duels against her show "Echo hints" (see §9). This is the strongest single expression of the mirror structure.
- **Mid-duel dialogue choices** carry no stat effect. They change how the rivalry develops: respect, hatred, or doubt.

---

## 6. The War Table (Acts I–III)

### 6.1 Presentation
A physical **campaign table** in a war tent (Loyalist) or a requisitioned palace map room (Rebel). The map is painted parchment, the tokens are carved wood and pewter, and candles burn down to mark the season. You physically move tokens.

### 6.2 Turn structure: one turn = one season (≈ 3 months)
1. **Intelligence phase:** scout reports arrive, some of them false.
2. **Deployment phase:** assign Ascendants, legions, and your hero squad to regions.
3. **Resolution:** battles where the hero squad is present become **playable tactical battles**. The rest auto-resolve, with odds shown in advance.
4. **Consequences:** supply, morale, Wellspring Instability, and Hollowed pressure update.
5. **Camp:** story scenes, bonds, letters, recruitment.

### 6.3 Resources
| Resource | Source | Spent on |
|---|---|---|
| **Supplies** | Held regions, allies, the Widow's granaries | Moving and feeding legions |
| **Banners** (legitimacy) | Victories, heirs held, public Ascendants | Recruiting provinces; lower banners can trigger defections |
| **Mana Reserve** | Wellspring stability (rebels), shrines (loyalists) | Faster rank-ups; recovering Ascendants from Exhaustion |
| **Intel** | Scouts, spared informants, Iskander's network | Revealing where enemy Ascendants are |

### 6.4 Ascendant tokens: the heart of the war table
- **Presence:** a region with an Ascendant wins any auto-resolved battle against one without an Ascendant. Two opposing Ascendants force a **playable** battle if your hero squad is there, and a weighted roll if not.
- **Hidden positions:** you never know for certain where an enemy Ascendant is. Scouting shows "Varek's banner over Ostmark". Is he actually there? **Banners can be faked**, and both sides can do it.
- **Exhaustion:** using a Domain removes that Ascendant from play for 1–2 seasons, so a decisive win now leaves you exposed later.
- **The anomaly (Sereth's fingerprint):** now and then an auto-resolve report says *"Our Radiants' mana failed without cause."* Players who notice the pattern and use Light-affinity scouts there gather evidence about the fifth Ascendant.

### 6.5 Global clocks
- **Wellspring Instability (0–100):** rises every season the throne is unbound, and faster if Mira escaped. Thresholds trigger **mana storms**: regions become unusable, Radiants misfire, and the aurora on the map turns from teal to a sick violet.
- **Hollowed Pressure (0–100):** rises while the Ember Line has no Ascendant. **Domains attract the Hollowed**: each Domain used near the north adds pressure. Overwhelming force against your human enemy invites the monsters.
- **The Act II decision (from the story):** when the Ember Line breaks, both campaigns face the same war-table choice. Strike, or send help north to fight beside your enemy. The Hollowed front then becomes a **shared battlefield**, where the opposing Ascendant can appear as a temporary ally token.

---

## 7. Campaign Mission Outline

Below are signature missions. Each act also has 3–5 smaller war-table battles.

### Loyalist: *The Lantern Road*
| Act | Mission | Hook |
|---|---|---|
| I | **The Servants' Tunnels** | Escort-retreat in the dark carrying wounded Elian (or Elian's body). Each turn he is carried slows the squad. |
| I | **The Road to Lysmere** | A moving battle across a refugee column. Protect civilians while rebel cavalry harasses you. |
| I | **The Scouts' Fate** | Choice scene, not a battle: execute or free the captured scouts. Freed scouts reappear in Act III. |
| I | **Lysmere Gate** | The defence where Aren breaks through to **Radiant**. Choose your affinity in the middle of the battle. |
| II | **The Widow's Price** | A political mission. Win the Widow of Frostmere in a "council battle", a dialogue skirmish using leverage, evidence, and promises. |
| II | **Iskander's Auction** | Outbid the rebels for the mercenaries, or make it impossible for them to accept the rebel gold. |
| II | **The Tower Heist** | Infiltrate Calderon and rescue Mira. A stealth-tactics remix of the coup-night map, now under rebel occupation. Kaela is on guard. |
| II | **The Burned Village Trial** | (Elian alive) The surrendering rebel commander. Elian's Vow against his soldiers' demand for death. The player chooses whom Aren backs. |
| II | **The Ember Line Breaks** | The fork: march north, or strike the capital. |
| III | **The Siege of Calderon** | Multi-stage: breach, streets, walls (final Kaela duel), Wellspring Hall (Sereth reveals Silence), and **Aren's Ascension** in the middle of the battle. |

### Rebel: *The Iron Dawn*
| Act | Mission | Hook |
|---|---|---|
| I | **Holding the Inner City** | Defend chokepoints against the Southern Legion. The coup-night map, now under siege from outside. |
| I | **The Jailer** | Not a battle: conversation scenes with Mira, built around **Trust**. Kaela's choices here drive the moral core of the campaign. |
| I | **The Proclamation** | Escort Varek to the public square to address the empire. Assassins sit in the crowd, and whether you can spot them depends on Intel. |
| I | **Kaela's Breakthrough** | Kaela reaches **Radiant** shielding a town from Loyalist reprisal, or from Ashen Wolf looting if her track leans Honor. |
| II | **Two Fronts** | War-table heavy. Varek and Grimm cannot be everywhere. |
| II | **Ashes of Home** | Return to Kaela's village on the Ember Line. Fight the Hollowed in the ruins. A playable flashback shows the winter Varek pulled her out. |
| II | **The Siphon** | Sereth's offer. Accepting gives the whole Rebel roster a rank boost and drains a region's Wellspring permanently, which shows visibly on the map as grey land. |
| II | **The Rite** | Varek pressures Mira. Kaela can help, refuse, or **secretly free Mira** in a solo stealth escape. |
| III | **The Defence of Calderon** | The mirror of the Loyalist siege. The same maps from the other side, and the same duel on the walls. |

### True Ending: *The Third Lantern*
A final battle that unlocks only after both campaigns. **Aren and Kaela fight on the same side**, with Elian and Varek as Ascendant allies, against Sereth's *Silence*. The battle introduces one new mechanic: under Silence, only **Vows** still function. Each character's Vow rule becomes their sole ability.

---

## 8. Storytelling Plan

### 8.1 Structure techniques
- **Cold open, then rewind:** begin with the lanterns going dark, then return to the festival.
- **Mirror scenes:** about 12 key scenes are written twice, once from each side, and the second version always **adds information** rather than repeating. Example: on the Loyalist side, Kaela hesitates on the tower stairs. On the Rebel side, you play the moment and learn that Mira is not what Kaela expected.
- **The withheld last words:** the Emperor's last words to Varek are a locked "memory" icon in Varek's codex entry. Lip-readable fragments appear across playthroughs, and the full line plays only in the true ending.
- **Role-slot scenes:** to handle the branches cheaply, Act scenes use a **Leader slot** (Elian or Orsa) and an **Heir slot** (Mira present, or Mira captive). Shared lines are written once, and only key lines are variant-specific (see §12).

### 8.2 Narrative systems
| System | What it is | Why it matters |
|---|---|---|
| **Moral tracks** | Mercy ↔ Resolve (Loyalist), Honor ↔ Iron (Rebel). Never shown as a number. Shown by how characters greet you, which camp music plays, and the colour of your banner. | Choices feel lived-in rather than scored. |
| **The Ledger** | Every named character who dies, including festival NPCs and spared enemies who come back, gets a line in a book you can open at camp. Varek reads his own Ledger in Act II. | The war's cost stays personal. |
| **Bonds** | Camp conversations with 8–10 companions per side, with 3 levels each. Max bonds unlock combo attacks and a personal epilogue. | The companionship that makes tactics RPGs memorable. |
| **Letters** | Between chapters, letters arrive from family, enemies, and Mira. Some are intercepted letters meant for the other side. | Shows the world from outside the front line. |
| **The Chronicle** | The codex is written by an in-world historian whose tone changes with the ending you get. | The same war reads as heroism or tragedy depending on who won. |
| **Evidence Board** | Sereth clues (ward sigils, anomaly reports, Conclave ledgers) are pinned to a board in camp. Exposing Sereth requires assembling them. | Rewards players who pay attention, and gates the true ending fairly. |

### 8.3 Vow authoring (Act III)
When the player ascends, the game builds their **Vow sentence** from words earned through earlier choices:

> *"I will* **[never abandon / end / stand between]** *the* **[weak / war / dark]**, *whatever* **[it costs / they become / follows]**."

Each phrase maps to a **rule** that holds for the rest of the game:
- *"never abandon the weak"* → you cannot retreat from a battle with civilians on the map; +50% Domain strength while protecting them.
- *"end this war, whatever it costs"* → your Domain can be used twice per battle, but each use permanently lowers your max HP for the battle.
- *"stand between my people and the dark"* → allies adjacent to you cannot be targeted, but you can never end a turn alone.

Breaking a Vow (for example, by choosing an act that violates it in a late story choice) **cracks the core**: the character loses Ascendant rank permanently. This is a real, dramatic, deliberate option.

### 8.4 Characters added to support play (placeholders)
| Name | Side | Role |
|---|---|---|
| **Pell Marrow** | Loyalist | Aren's commoner classmate. Comic relief who becomes the heart of the company. Can die at Lysmere Gate. |
| **Sergeant Dunla** | Loyalist | City Watch veteran who thinks knights are overrated. A tank. |
| **Old Brannoc** | Neutral | Palace servant and the key to the hidden route. Appears in both campaigns. |
| **Rook** | Rebel | Ashen Wolf scout half-blinded by the Hollowed. Sees mana instead of light, so she is immune to darkness. Can sense Sereth. |
| **Hask & Vey** | Rebel | Brothers in the Ashen Wolves who disagree about the coup. Their arc mirrors Elian and Varek's. |

### 8.5 Recommended answers to the remaining open questions
- **Q2 (Elian's death branch):** Keep death permanent. A return from the Wellspring would undercut the coup's stakes and the theme. In the Elian-dead variant, his **Sanctuary** can appear once as a lingering imprint in the Wellspring Hall. It is a memory, not a resurrection.
- **Q3 (Ascendant count):** Keep five. Two per faction plus one hidden suits the war table: each side can be in two places, and the fifth piece is the mystery. Three would make every battle predictable.
- **Q4 (tone):** **Bittersweet-hopeful.** Dark events, humane characters. No ending is purely triumphant, but the true ending is earned light.

---

## 9. Cross-Campaign "Echoes" (the meta layer)

After finishing a campaign, the other campaign gains **Echoes**: small, optional, diegetic advantages and new scenes.
- **Knowledge Echoes:** duel tells for your rival; the location of a ward anchor; the patrol route in the Tower Heist.
- **Scene Echoes:** extra lines where your character seems to sense the other side ("Kaela pauses, as if she has heard this before").
- **Mira's Trust** is shared between the two campaigns. It is the key that unlocks the true ending.
- **The Evidence Board** keeps clues found in the other campaign, marked "from another account."

Echoes are presented as **memory, not power-ups**, which fits the theme: understanding the other side is the true path.

---

## 10. Art Direction and Graphics

### 10.1 Overall look: "Lantern-lit dioramas"
- **Recommended style:** stylized 3D environments with **hand-painted textures**, viewed through a **tilt-shift tactical camera**. The battlefield should look like a lit miniature set on a table.
- **Characters:** stylized 3D models (about 1:5 head-to-body, readable at a distance) for battles. **Hand-painted 2D portraits** with 4–6 expressions each for dialogue. **Full illustrated CGs** for about 20 key moments.
- **Why 3D rather than pixel art:** the core mechanics (darkness, lanterns, dawn sweeping across the map, Domains reshaping terrain) all depend on **dynamic lighting**. Stylized 3D does this cheaply and well, and animation is far cheaper than hand-drawn sprites with many directions.
- **Alternative (if the team has a strong pixel artist):** HD-2D, meaning pixel-art sprites in 3D dioramas with modern lighting, in the style of *Triangle Strategy* or *Octopath Traveler*. It looks beautiful and fits tactics, but sprite animation for many unit types costs more.

### 10.2 Visual language
| Element | Loyalists | Rebels |
|---|---|---|
| Shapes | Round, arched, lantern silhouettes | Angular, jagged, wolf-tooth crenellations |
| Palette | Ivory, gold, deep blue | Ash grey, iron, ember red |
| Materials | Polished brass, white linen, stained glass | Blackened steel, fur, scorched leather |
| Banner | A lantern with a flame of open hands | A wolf's head with lightning |

**Affinity colours**, always paired with a **shape icon** for colour-blind players: Flame (orange, triangle), Frost (pale cyan, hexagon), Storm (violet-white, zigzag), Stone (ochre, square), Light (gold, circle), Void (**no colour**: it desaturates whatever it touches).

### 10.3 Colour script by chapter
| Section | Dominant palette | Lighting mood |
|---|---|---|
| Festival | Warm amber on indigo dusk | Thousands of lanterns, celebratory |
| Coup night | Near-black indigo, cut with amber pockets and violet lightning | Darkness as the default; light is precious |
| Dawn | Rose-gold rising from the east | Relief for Loyalists, dread for Rebels |
| Lysmere | Terracotta, olive, warm sun | Safety, but fragile |
| Ember Line | Snow white, ash grey, ember red | Cold, wind, frontier |
| Mana storms | Sick violet aurora, teal veins in the ground | Wrongness |
| Wellspring Hall | Luminous teal-cyan river beneath black stone | Sacred, ancient |
| Siege of Calderon | Overcast steel with fires burning | War-weary |
| True ending | Every lantern relit, one by one | Earned hope |

### 10.4 Signature visual moments
1. **The lanterns go dark**: a wave of darkness sweeps across the whole city in one shot.
2. **Tempest over the palace**: the sky splits, and rain and lightning engulf the dome.
3. **Pyre vs Bulwark in the Feast Hall**: fire roaring against rising stone walls while you fight between them.
4. **Dawn arrives**: real-time light sweeps across the Night Map, district by district.
5. **The Silence reveal**: colour drains, the music cuts, and Sereth is the only thing in colour.
6. **Ascension**: the Vow sentence writes itself in light around the character, word by word, assembled from the player's choices.
7. **The Third Lantern**: Aren and Kaela, each holding a lantern, light the third together.

### 10.5 Technical art features
- Dynamic point lights for every lantern (pooled and baked where static).
- Fire-spread simulation drawn as a decal and particle system on tiles.
- Weather and time-of-day system driving the dawn gradient.
- Domain post-processing: per-Domain shader stack (heat haze, rain plus chromatic flash, golden bloom, greyscale for Silence).
- War table: real 3D props with candle shadows. Token animations are physical, so tokens slide, tip over, and get knocked down.

---

## 11. Audio Direction

- **Bells are the game's leitmotif.** Every Bell on coup night has its own tolling pattern. The same bells return in the finale.
- **Character themes:** the Emperor's lullaby, which Varek hums once in Act II; Elian's choir; Varek's storm strings; Kaela's frontier fiddle; Aren's simple flute. Mirror scenes reuse the opponent's theme in a minor or major key.
- **Silence is a designed sound:** under Sereth's Domain all music and mana sound effects stop, leaving only footsteps and breathing.
- **Adaptive music:** layers add or drop with time pressure, Nerve, and Domain activations.
- **Voice:** full voice for key cutscenes; barks plus short voiced lines in battle; the rest text-only. This keeps cost manageable.

---

## 12. How It Gets Made

### 12.1 Engine and tools (recommended)
| Need | Choice | Why |
|---|---|---|
| Engine | **Godot 4** (GDScript, with C# for heavy simulation if needed) | Free, open source, strong for stylized 3D, no runtime fees. Choose Unity only if the team already knows it well. |
| Dialogue | **Yarn Spinner for Godot** or **Ink** (via godot-ink) | Writers work in plain text with variables and branches; the game reads the same story flags. |
| Grid and pathfinding | Godot's `AStarGrid2D`/`AStar3D` plus a custom tile-data layer | Height, light level, terrain type, and fire state stored per tile. |
| Data | Godot Resources for units, skills, missions, Domains | Designers can tune numbers without writing code. |
| Art | Blender (models), Substance or hand-painted Krita textures, Krita or Photoshop (portraits) | Standard indie pipeline. |
| Audio | Reaper plus FMOD or Godot's built-in adaptive bus system | Needed for the music layers. |
| Version control | Git with Git LFS for art | Already in use. |

### 12.2 Code architecture (high level)
```
core/
  GameState          # flags, moral tracks, Ledger, Spared, Echoes (meta save)
  SaveSystem         # per-campaign saves + a cross-campaign meta save
story/
  DialogueRunner     # Yarn/Ink bridge reading/writing GameState
  SceneDirector      # cutscene sequencing, role-slot substitution
night_map/
  BellClock          # minutes, bell events, delays/hastes
  DistrictGraph      # nodes, travel costs, ownership
  FrontSimulator     # auto-resolves off-screen squads
tactics/
  Grid, Tile         # height, light, terrain, fire
  TurnManager        # initiative, phases, clock ticks
  AbilitySystem      # data-driven skills, combos, Domains
  IntentSystem       # telegraphs enemy actions
  AI                 # utility-scoring AI (objective-aware)
  DuelSystem         # Blade Reading 1v1
war_table/
  RegionGraph, Tokens, Resolver, GlobalClocks
tools/
  BranchJumper       # debug: jump to any variant/flag state
  MissionEditor      # in-editor mission authoring
```

### 12.3 Production phases
Estimates assume a **small team of 4–6** (1 designer/lead, 2 programmers, 1–2 artists, 1 writer, contracted audio). A solo developer should take only the **Scope Tier 1** below.

| Phase | Duration | Deliverable | Exit test |
|---|---|---|---|
| **0. Paper prototype** | 3–4 weeks | Bell Clock and Night Map on paper with tokens; war table in a spreadsheet | Is choosing where to spend minutes tense and fun with no graphics at all? |
| **1. Graybox tactics** | 2 months | One tactical battle with grey cubes: light/dark, subdue/kill, intents | Is a single battle fun with programmer art? |
| **2. Art target** | 1 month, in parallel | One finished diorama (Princess's Tower), one character, one portrait, one Domain effect | Does a single screenshot sell the game? |
| **3. Vertical slice** | 4–5 months | **The Rebel side of coup night**, fully playable and polished | Do outside playtesters finish it and want to play the other side? |
| **4. Full Prologue** | 3–4 months | Both sides of coup night plus the festival hub. **Public demo** (e.g. Steam Next Fest). | Wishlists and playtest feedback. |
| **5. Campaign production** | 14–18 months | Acts I–III for both campaigns, war table, bonds | Each act tested for the "one more turn" pull. |
| **6. Endings and true ending** | 2–3 months | All endings and the meta layer | Both campaigns played back to back by testers. |
| **7. Polish, localisation, launch** | 3–4 months | Accessibility, balance, performance, ports | Shippable build. |
| **Total** | **≈ 2.5–3 years** | | |

### 12.4 Scope tiers (choose one early)
| Tier | Content | Fit |
|---|---|---|
| **1. The Night** | The festival and coup night from both sides, plus a short epilogue per outcome | Solo or duo, about 8–12 months. Already a complete, replayable game (4–6 h per side). |
| **2. One Road** | Tier 1 plus **one** full campaign (recommended: Rebel, the more surprising one), the other side as a later expansion | Small team, about 1.5–2 years |
| **3. Full Crown** | Everything in this document | Small team plus contractors, about 2.5–3 years |

### 12.5 Keeping content costs down
- **Map reuse through mirroring:** each major map (Tower, Feast Hall, Walls, Wellspring) is used in both campaigns with different lighting, damage state, and objectives. That gives about 40% map savings.
- **Role slots** for branches, as in §8.1, rather than fully separate scenes.
- **Canonical path first:** build and polish Emperor killed, Elian wounded, Mira imprisoned. Variant lines are added in a later pass, only where they change meaning.
- **Branch Jumper debug tool** from day one: branching narrative is impossible to test without it.

---

## 13. Risks and Mitigations

| Risk | Why it is dangerous | Mitigation |
|---|---|---|
| **"Whoever has an Ascendant wins" is boring** | Removes decisions from battles | Domains are temporary, cause Exhaustion, and attract the Hollowed; Silence counters everything; most hero-squad missions are designed around an Ascendant's absence or arrival. |
| **Time pressure feels unfair** | Players hate losing to an invisible clock | The Bell Clock is always visible; every action shows its cost in minutes before you commit; an optional **"Bells wait for you"** accessibility setting. |
| **Two campaigns double the work** | Scope explosion | Scope tiers, map mirroring, and making the second campaign a remix rather than a copy. |
| **Branching becomes unmanageable** | Bugs and wasted writing | Role slots, a canonical-first approach, and automated flag-coverage tests in the Branch Jumper. |
| **Loyalists cannot save the Emperor** | Feels predetermined | The hidden route exists and is hard but fair. Signpost its existence through Echoes after the first playthrough. |
| **Mercy is mechanically weaker** | Players pick cruelty for efficiency | Spared enemies bring tangible rewards (recruits, Intel, shelter) as well as risks, and the best endings require mercy. |

---

## 14. Immediate Next Steps

1. **Decide the scope tier** (§12.4) and the art style (§10.1: stylized 3D or HD-2D).
2. **Paper-prototype coup night** (§4.2) with a printed city map, tokens, and a kitchen timer. This tests the most important idea for almost no cost.
3. **Write a beat sheet for the canonical path of coup night** from both sides, listing every mirror scene.
4. **Set up a Godot 4 project** with the folder structure in §12.2 and a graybox Princess's Tower battle.
5. **Commission or paint one key-art piece:** the lanterns going dark over Calderon. It becomes the art target, the pitch image, and the store capsule.
