# AntenbOro Changelog

All notable changes to this project.

## [Unreleased]

### Chamber & Terrain Improvements
- **Chamber tunnel openings** — `_cutTunnelHoles()` removes sphere geometry triangles where tunnels connect, creating natural open doorways between chambers and corridors
- **Terrain-integrated ant hills** — Mound shapes baked directly into terrain mesh via `applyNestMoundsToTerrain()` with vertex color blending (green grass → brown dirt); separate LatheGeometry mound removed. Ant hill *is* the terrain now.
- **Split terrain height API** — `getBaseTerrainHeight()` for rolling hills only; `getTerrainHeight()` includes mound bumps. Nest decorations snap to base height so they don't float.

### Underground System (Phase 1 — Complete)
- **Underground data structure** — `ColonyUnderground` graph with nodes (chambers) and edges (tunnels)
- **Underground 3D scene** — Separate Three.js scene with earthy brown BackSide materials, warm fog, hemisphere lighting
- **Starter layout** — Entrance chamber → tunnel → Queen Chamber, pre-built on init
- **Scene transition** — Press E near nest to enter underground, E at entrance to exit
- **Underground FPS** — WASD movement constrained to tunnel corridors, wall collision via `constrainPosition()`
- **Entrance sky portal** — Partial-sphere earthy walls with sky disc at top, daylight PointLight pouring in
- **Tunnel corridor lights** — PointLights spaced every ~2.5 units along each tube for visibility
- **Tunnel-chamber joins** — Tube endpoints shortened to stop at chamber boundaries, hollow spaces connect cleanly
- **Queen mesh underground** — Queen ant rendered in queen chamber with wandering + gaster pulse animation
- **Brood underground** — Eggs, larvae, pupae scattered on queen chamber floor with stage-specific animations
- **HUD mode indicator** — Shows UNDERGROUND / FPS / OVERHEAD with context-appropriate key hints

### Surface Improvements
- **Terrain-integrated ant hills** — Mound shapes baked into terrain mesh with vertex color blending; decorations (hole, ring, crumbs) placed on top
- **Terrain height system** — `getTerrainHeight()` includes cosine-falloff bumps near nests; ants walk over the hill
- **Player colony queen hidden on surface** — Queen mesh only exists underground now

### Earlier Features
- Anatomically accurate ant meshes (Formicidae morphology per caste)
- 4-channel pheromone system (food × 2, alarm × 2)
- Alarm pheromone combat (soldiers swarm, workers partially respond)
- Queen egg-laying with gaster contraction animation
- Full brood lifecycle: egg → larva → pupa → adult (with distinct 3D meshes)
- Visual effects: hit flash, death animation, leg animation, food indicator, particles, bloom
- 3D pheromone trail visualization (InstancedMesh ground quads)
- Dual view modes: FPS (mouse look) + Overhead strategy (TAB toggle)
- 2D strategy canvas with pan/zoom, minimap
- 400×300 world grid, 0.6 cell size, analytical terrain height
