# Contributing to AntenbOro

## Quick Start

```bash
git clone <repo-url>
cd antenboro2
python -m http.server 8000
# Open http://localhost:8000
```

No build step. No npm install. Just a web server.

## Project Structure

```
src/
├── main.js              # Game init, loop, mesh sync, UI
├── sim/                 # Simulation layer (no rendering)
│   ├── config.js        # All tunable constants
│   ├── index.js         # SimulationEngine orchestrator
│   ├── ant.js           # Ant entity (AI, movement, combat)
│   ├── colony.js        # Colony manager (queen, ants, brood)
│   ├── world.js         # World grid, food patches, combat
│   ├── pheromone.js     # 4-channel pheromone diffusion
│   └── underground.js   # ColonyUnderground graph structure
├── render/              # Three.js rendering layer
│   ├── scene.js         # Surface scene, ant meshes, terrain, bloom
│   ├── player.js        # Player input, camera, FPS/overhead/underground
│   └── underground.js   # Underground scene renderer
index.html               # Single-page app, importmap for Three.js CDN
```

## Architecture Rules

1. **sim/ never imports from render/** — Simulation is rendering-agnostic
2. **render/ reads sim state but never mutates it** — One-way data flow
3. **main.js bridges sim ↔ render** — Mesh sync, input routing, game loop
4. **No build tools** — Vanilla ES modules, importmap for Three.js
5. **Config is centralized** — All tunable values live in `src/sim/config.js`

## Code Style

- ES module `import`/`export` only
- Classes for major subsystems, plain functions for utilities
- JSDoc comments on public methods
- `console.log('✓ ...')` for init milestones, `console.log('🐜 ...')` for ant events

## Cache Busting

When modifying any `src/` file, bump the version query in `index.html`:
```html
<script type="module" src="src/main.js?v=XX"></script>
```
Increment `XX` by 1 each change. This ensures the browser loads fresh code.

## Adding a Feature

1. **Sim first**: Add logic to `src/sim/` — new ant behavior, colony mechanic, etc.
2. **Render second**: Add visuals in `src/render/` — meshes, materials, animations
3. **Wire in main.js**: Connect sim state to render updates in the game loop
4. **Update config**: Any tunable value → `CONFIG` constant
5. **Test**: Load in browser, check console for errors, verify gameplay

## Underground Development

The underground system uses a graph structure:
- **Nodes** = chambers (entrance, queen_chamber, nursery, food_store, barracks, tunnel_junction)
- **Edges** = tunnel corridors connecting chambers
- **Coordinates** = local space per colony, origin at entrance (0,0,0)
- **Rendering** = separate Three.js scene with BackSide materials, warm lighting

Key files:
- `src/sim/underground.js` — `ColonyUnderground` data structure
- `src/render/underground.js` — `UndergroundRenderer` (tunnel/chamber mesh generation)
- `src/render/player.js` — E-key entry/exit, underground FPS movement, tunnel collision

## Performance Notes

- Target: 60 FPS with 300 ants, 2 colonies, full underground
- Ant meshes use shared geometries (one per caste) + individual materials for hit flash
- Pheromone visualization uses InstancedMesh (sampled every 3 cells)
- Particle system: 500-particle Points buffer with additive blending
- Underground lights: ~3-4 per tunnel corridor, 1-2 per chamber
