# AntenbOro 🐜

A fused 3D first-person ant colony strategy game combining **Antenboro** (immersive 3D FPS world) and **Ant Simulator** (deep pheromone-based colony simulation).

## Overview

You are a **hero ant** in first-person control of your colony's war against a rival nest. Your actions—foraging, fighting, building, and rallying pheromones—directly impact whether your colony survives.

### Key Features

✅ **3D Immersive World** — Terrain, terrain generation, dynamic lighting with PBR materials  
✅ **Pheromone AI System** — Two colonies with independent pheromone channels, foraging, combat behavior  
✅ **Player Hero Ant** — FPS controls with special abilities (pick food, deposit, bite, rally pheromones, build)  
✅ **Real-Time Colony War** — Two rival colonies competing for food and dominance  
✅ **Dual Camera Views** — FPS mode (real-time 1× speed) and overhead strategic mode (speed controls 1–8×)  
✅ **Fixed-Timestep Sim** — 30 ticks/sec simulation decoupled from render frames  
✅ **Live Minimap** — Shows food, ants, pheromone heatmap, nest locations  
✅ **Win/Lose Conditions** — Destroy enemy queen (victory) or lose yours (defeat)  

## Project Structure

```
antenboro2/
├── index.html              # Main entry point with canvas and HUD
├── package.json            # Dependencies (Three.js v0.169.0)
├── src/
│   ├── main.js             # Game initialization and main loop
│   ├── sim/                # Simulation core (ES modules)
│   │   ├── config.js       # All tunable constants in one place
│   │   ├── ant.js          # Ant entity with state machine
│   │   ├── colony.js       # Colony manager (queen, ants, food)
│   │   ├── pheromone.js    # Pheromone grid and decay
│   │   ├── world.js        # World grid, food patches, obstacles
│   │   └── index.js        # SimulationEngine (orchestrates sim)
│   └── render/             # Three.js rendering
│       ├── scene.js        # SceneManager (lights, materials, meshes)
│       └── player.js       # PlayerController (FPS input, hero ant)
└── assets/                 # Placeholder for future textures/models
```

## Getting Started

### Prerequisites
- Python 3 (for local HTTP server)
- Modern browser with WebGL support

### Running Locally

```bash
cd antenboro2
python3 -m http.server 8000
```

Open `http://localhost:8000` in your browser.

## Controls

| Key | Action |
|-----|--------|
| **W/A/S/D** | Move forward/left/back/right |
| **F** | Pick up food (stand near a food patch) |
| **E** | Deposit food at nest (stand near nest) |
| **Click** | Bite nearest enemy ant |
| **Q** | Deploy rally pheromone (attracts friendly ants) |
| **B** | Open build menu (not yet implemented) |
| **TAB** | Toggle FPS ↔ Overhead camera mode |
| **P** | Pause simulation |
| **Arrow Keys** | (Overhead mode) Speed controls (1×/2×/4×/8×) |

## Simulation Details

### Ants
- **Types**: Worker, Soldier, Queen
- **State Machine**: WANDERING → FOLLOWING → CARRYING → FIGHTING → GUARDING
- **Lifespan**: ~3000 ticks (~100 seconds at 30 ticks/sec)
- **Health**: Workers (5 HP), Soldiers (10 HP), Queen (50 HP)
- **Combat**: Click to bite enemies; damage scales by type

### Colonies
- **Player Colony** (black): Starts at grid (15, 37)
- **Enemy Colony** (red): Starts at grid (85, 37)
- **Pheromone Channels**: Separate grids per colony for navigation/homing
- **Foraging Loop**: Wander → detect food → follow trail → carry home → deposit
- **Reproduction**: Queen lays eggs when food > threshold; eggs → larvae → pupae → adults

### Simulation Loop
- **Fixed timestep**: 1/30 second per tick (~33ms)
- **Speed modes**: 
  - FPS mode: always 1× (real-time)
  - Overhead mode: 1×, 2×, 4×, 8× via arrow keys
- **Pheromone decay**: 95% per tick (5% loss)
- **Food deposition**: Ants carry 1 food unit at a time

## Configuration

All tunable constants are in `src/sim/config.js`:

```javascript
CONFIG = {
  TICKS_PER_SECOND: 30,           // Main sim speed
  WORLD_WIDTH: 100,               // Grid cells
  WORLD_HEIGHT: 75,
  WORLD_SIZE_3D: 60,              // 3D world units
  INITIAL_WORKERS: 30,
  INITIAL_SOLDIERS: 10,
  FOOD_CLUSTERS: 8,
  ANT_SPEED: 0.3,                 // Cells per tick
  BITE_COOLDOWN: 8,               // Ticks between bites
  PHEROMONE_DECAY_RATE: 0.95,     // Per tick
  // ... many more
};
```

Modify these to tune gameplay balance and difficulty.

## Development Roadmap

### Phase 1: Core Systems (In Progress)
- [x] Simulation core (ants, colonies, pheromones)
- [x] Three.js rendering pipeline
- [x] Player controller with FPS mechanics
- [x] Fixed-timestep game loop
- [ ] Debug and test core behavior
- [ ] Polish ant models

### Phase 2: Features
- [ ] Building system with colony bonuses
- [ ] Enemy AI tuning
- [ ] Particle effects
- [ ] Audio system
- [ ] Minimap refinement

### Phase 3: Polish
- [ ] Post-processing (bloom, SSAO, SMAA)
- [ ] Atmospheric effects (fog, dust, lighting)
- [ ] Onboarding/tutorial
- [ ] Performance optimization (InstancedMesh, LOD)
- [ ] Mobile support (optional)

## Performance Notes

- **Target ant count**: ~300 total (150 per colony)
- **Render**: InstancedMesh used for ant legs to reduce draw calls
- **Pheromone**: Grid-based (100×75) for O(1) lookups; no expensive diffusion by default
- **Shadow quality**: 4096×4096 shadow map with PCF soft shadows

## Known Issues & TODOs

- [ ] Terrain texture variation incomplete
- [ ] Ant leg animation not yet synced to movement
- [ ] Building menu UI not implemented
- [ ] Fog of war minimap not implemented
- [ ] Audio system only placeholder
- [ ] No mobile touch controls
- [ ] Post-processing (bloom/SMAA) commented out in scene setup

## Future Enhancements

1. **Advanced AI** — Threat detection, dynamic foraging strategies, defensive formations
2. **Building Bonuses** — Nursery (faster egg hatching), food store (higher cap), barricade (blocks pathing)
3. **Terrain Hazards** — Water, rocks, that affect pathfinding
4. **Multiplayer** — Two players controlling each colony (WebSocket needed)
5. **Replays & Spectate** — Watch your ants in action from any angle
6. **Mod Support** — Custom ant skins, colony colors, rule tweaks

## Credits

- **Antenboro** — Original 3D ant FPS by Petrofang
- **Ant Simulator** — Original 2D colony sim by Petrofang
- **Three.js** — WebGL rendering library
- **Fused by**: Petrofang + GitHub Copilot

## License

MIT (or same as original repos)

---

**Status**: Early Alpha — Core systems complete, extensive testing and tuning in progress.  
**Last Updated**: February 24, 2026
