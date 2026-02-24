# AntenbOro — Design Principles & Vision

## Inspirations

### SimAnt (Maxis, 1991)
The original ant colony game. You *are* an ant. You recruit, forage, fight, and manage the colony from within. The magic is the tension between being a tiny individual and influencing a superorganism. We take from SimAnt:
- **First-person ant identity** — you live in the colony, not above it
- **Colony lifecycle** — eggs, larvae, pupae, castes, queen dependency
- **Territory warfare** — rival colony competing for the same yard
- **Underground nest building** — digging tunnels and chambers is *the* base-building mechanic

### Dwarf Fortress (Bay 12 Games, 2006–)
The deepest colony simulation ever made. Every entity has needs, every material has properties, every room has a purpose. We take from Dwarf Fortress:
- **Emergent complexity** — simple rules creating rich, surprising behavior
- **Room designation over direct control** — you designate chambers (nursery, food store, barracks), dwarves/ants figure out the rest
- **Hybrid autonomy** — workers act on their own, but the player provides strategic direction
- **The fortress *is* the game** — building and expanding your underground base is the core loop

### RimWorld (Ludeon Studios, 2018)
The accessible colony sim. Takes Dwarf Fortress depth and makes it readable, playable, and paced. We take from RimWorld:
- **Clear feedback loops** — you can see what's working and what isn't
- **Threat escalation** — early game is calm foraging, late game is desperate defense
- **Room bonuses** — specialized rooms provide tangible buffs to the colony
- **Storytelling through simulation** — memorable moments emerge from systems interacting

---

## Core Design Pillars

### 1. You Are the Ant
The player is a hero worker ant in the colony. You see the world at ant scale — blades of grass are trees, pebbles are boulders, the nest entrance is a cave mouth. First-person immersion is paramount.

### 2. The Colony Is Alive
Ants forage, fight, build, and reproduce with or without you. Pheromone-driven AI creates emergent swarm behavior. The queen lays eggs. Workers dig tunnels. Soldiers patrol. Life goes on — your actions tip the balance.

### 3. Underground Is Home
The nest is not a menu — it's a place. You walk through tunnels, visit the queen chamber, check the nursery, inspect food stores. Building underground infrastructure is the primary base-building mechanic, like Dwarf Fortress or SimAnt.

### 4. Surface Is the Frontier
Above ground is dangerous, resource-rich, and contested. Foraging runs, enemy encounters, environmental hazards. The surface is where you earn resources; underground is where you spend them.

### 5. Hybrid Control
You don't micromanage every ant. You set priorities (dig here, build nursery there, rally to this position) and workers execute. Like Dwarf Fortress room designation — strategic decisions, autonomous execution.

### 6. Readable Complexity
Deep simulation, clear presentation. Every system should be understandable at a glance but reward attention. Status panels, visual cues (pheromone trails, brood stages, chamber labels), and progressive disclosure.

---

## Game Loop

```
┌──────────────────────────────────────────────────┐
│                 SURFACE (Overworld)               │
│                                                    │
│  Forage food ──→ Fight enemies ──→ Scout territory │
│       ↓                                  ↓         │
│  Carry food home              Rally allies         │
│       ↓                          ↓                 │
│  ┌─── Enter Nest ─────────────────┘                │
│  ↓                                                 │
│  ┌──────────────────────────────────────────────┐  │
│  │            UNDERGROUND (Colony)              │  │
│  │                                              │  │
│  │  Deposit food ──→ Designate chambers         │  │
│  │       ↓                  ↓                   │  │
│  │  Feed colony      Workers dig & build        │  │
│  │       ↓                  ↓                   │  │
│  │  Queen lays eggs  Chambers provide bonuses   │  │
│  │       ↓                  ↓                   │  │
│  │  Colony grows ←── Nursery speeds hatching    │  │
│  │       ↓                                      │  │
│  │  More ants = more foragers & soldiers        │  │
│  │       ↓                                      │  │
│  │  Exit Nest ──────────────────────────→       │  │
│  └──────────────────────────────────────────────┘  │
│       ↓                                            │
│  Larger army ──→ Push deeper into enemy territory  │
│       ↓                                            │
│  Assault enemy nest ──→ Kill enemy queen ──→ WIN   │
└──────────────────────────────────────────────────────┘
```

---

## Underground System

### Structure
The underground is a **graph of nodes connected by tunnel edges**:
- **Nodes** = chambers (rooms with a type and purpose)
- **Edges** = tunnel corridors (walkable connections between chambers)

### Chamber Types
| Chamber | Cost | Effect | Inspired By |
|---------|------|--------|-------------|
| **Entrance** | Free | Surface access point | SimAnt |
| **Queen Chamber** | Free | Queen + egg laying | SimAnt |
| **Nursery** | 25 food | -20% hatch time for eggs/larvae/pupae | DF Bedroom |
| **Food Store** | 20 food | +500 food cap, prevents spoilage | DF Stockpile |
| **Barracks** | 30 food | +2 soldier HP, soldier spawn point | DF Barracks |
| **Tunnel Junction** | 10 food | Connects to new areas, movement speed boost | SimAnt |
| **Barricade** | 12 food | Blocks enemy ant invasion routes | RimWorld Walls |

### Digging & Building
- **Auto-dig**: Idle workers slowly extend the tunnel network from existing junctions. The colony grows organically.
- **Player designation**: Press B underground to open the build menu. Select a junction node → choose chamber type → workers are dispatched to dig it out. Costs food.
- **Construction time**: Chambers take N worker-ticks to complete. More workers = faster.

### Visual Style
- **Tunnels**: Tube corridors with earthy brown walls, dim point lighting
- **Chambers**: Wider cave-like rooms, each with visual identity (nursery has eggs/larvae, food store has golden piles, barracks has weapon-like mandible racks)
- **Atmosphere**: Short-range warm fog, ambient particle dust, occasional drip effects
- **Contrast**: Underground is cozy and warm; surface is bright and dangerous

---

## Technical Architecture

### Rendering
- **Separate Three.js scene** for underground (not a sub-terrain layer in the main scene)
- Player transitions between scenes via E key at nest entrance
- Each scene has its own lighting, fog, and atmosphere
- Bloom post-processing on surface only; underground uses raw renderer for earthy feel
- Strategy/overhead view shows surface map; disabled while underground

### Surface World
- **Terrain-integrated ant hills**: Mound shapes are baked directly into the terrain mesh via `applyNestMoundsToTerrain()` — the ant hill *is* the terrain, not a separate floating object. Vertex colors blend from green grass to brown dirt near nests. Decorations (entrance hole, colony ring, dirt crumbs) sit on top.
- **Terrain height**: `getTerrainHeight()` (analytical, no raycast) adds cosine-falloff mound bumps near each nest — ants walk *over* the hill. `getBaseTerrainHeight()` returns rolling hills only (used to position nest decorations at ground level).
- **Anatomically accurate ant meshes**: Formicidae morphology (head, mesosoma, petiole, gaster, compound eyes, elbowed antennae, jointed legs, mandibles)
- **Caste differentiation**: Worker (standard), Soldier (massive head + mandibles), Queen (distended physogastric gaster)
- **Visual effects**: Hit flash, death animation, walking leg animation, food-carrying indicator, particle bursts, bloom post-processing, 3D pheromone trail visualization

### Underground World
- **Tunnel tubes**: BackSide TubeGeometry with earthy brown walls, point lights spaced along corridors
- **Chamber spheres**: BackSide SphereGeometry with tunnel openings cut via `_cutTunnelHoles()` — triangles facing connected tunnel directions are removed so chambers have natural open doorways
- **Entrance chamber**: Partial-sphere earthy walls with sky disc at top, strong daylight PointLight pouring down — reads as "hole to the outside"
- **Tunnel-chamber joins**: Tube endpoints shortened to stop at chamber radius boundary; chamber walls have holes cut where tunnels connect, creating seamless walkable connections
- **Atmosphere**: HemisphereLight (cool sky / warm earth), moderate ambient, short-range warm fog

### Simulation
- **ColonyUnderground** data structure: graph of nodes + edges per colony
- Underground has its own coordinate space; ants transition at entrance node
- Queen and brood (eggs/larvae/pupae) live underground; separate mesh instances in underground scene
- 4 pheromone channels: player food, enemy food, player alarm, enemy alarm
- Alarm pheromone: fighting ants deposit alarm, soldiers respond 90%, workers 40%

### Coordinate Systems
- **Surface**: 400×300 grid → 240×180 3D units (existing)
- **Underground**: Local coordinate space per colony, origin at entrance node
- Ants transition between coordinate systems at the entrance node

---

## Development Phases

### Phase 1: Underground Foundation ✅ COMPLETE
- [x] Underground scene (lighting, ceiling, floor)
- [x] Starter colony layout (entrance tunnel + queen chamber)
- [x] E-key scene transition (enter/exit nest)
- [x] Queen + brood render underground
- [x] Camera controls underground (FPS in tunnels)
- [x] Tunnel corridor point lights for visibility
- [x] Entrance chamber sky portal (earthy walls + sky disc + daylight)
- [x] Surface ant hill mounds (LatheGeometry + terrain height integration)
- [x] HUD mode indicator (FPS / OVERHEAD / UNDERGROUND)

### Phase 2: Tunnel Network — PARTIALLY COMPLETE
- [x] Graph data structure for underground (`ColonyUnderground`)
- [x] Tunnel mesh generation (TubeGeometry with shortened endpoints)
- [x] Chamber mesh generation (BackSide SphereGeometry interiors)
- [x] Chamber tunnel openings (`_cutTunnelHoles()` removes faces at connection points)
- [x] Terrain-integrated ant hills (`applyNestMoundsToTerrain()` bakes mounds + vertex colors into terrain mesh)
- [x] Wall collision in tunnels (`constrainPosition()`)
- [ ] Worker auto-dig AI
- [ ] Multiple tunnel junctions and branching paths

### Phase 3: Building System
- [ ] B-key build menu UI underground
- [ ] Chamber designation + construction
- [ ] Chamber bonus effects
- [ ] Food store / nursery / barracks mechanics
- [ ] Visual identity per chamber type (distinct props & colors)

### Phase 4: Underground Ecosystem
- [ ] Underground pheromone trails
- [ ] Underground strategy view (2D tunnel map)
- [ ] Enemy colony underground (mirrored system)
- [ ] Tunnel invasion mechanics
- [ ] Barricade defense system

---

## Guiding Constraints

1. **No build step** — vanilla ES modules served via `python -m http.server`
2. **Performance budget** — 60 FPS with 300 ants, 2 colonies, full underground
3. **Single HTML page** — everything in `index.html` + `src/` modules
4. **Three.js only** — no additional rendering libraries
5. **Simulation-first** — every visual feature must be backed by sim state; no cosmetic-only systems
6. **Incremental delivery** — each phase is playable before the next begins
