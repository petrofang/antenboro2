/**
 * Central configuration object for the ant colony simulation.
 * All tunable constants in one place.
 */
const CONFIG = {
  // === SIMULATION TIMING ===
  TICKS_PER_SECOND: 30,        // Main sim runs at 30 ticks/sec (slow relaxed pace, 2.5× slower than original 180)
  SPEED_LEVELS: [1, 2, 4, 8],  // Speed multipliers for overhead view; FPS view always locked to 1×
  
  // === WORLD GRID ===
  WORLD_WIDTH: 400,            // Grid width in cells (big world)
  WORLD_HEIGHT: 300,           // Grid height in cells
  WORLD_SIZE_3D: 240,          // 3D world size in units (400 cells × 0.6)
  CELL_SIZE: 0.6,              // 3D units per grid cell
  
  // === NEST & COLONIES ===
  PLAYER_COLONY_NEST_X: 50,    // Player (black) colony nest grid X
  PLAYER_COLONY_NEST_Y: 150,   // Player (black) colony nest grid Y
  ENEMY_COLONY_NEST_X: 350,    // Enemy (red) colony nest grid X
  ENEMY_COLONY_NEST_Y: 150,    // Enemy (red) colony nest grid Y
  NEST_RADIUS: 8,              // Nest entrance radius in cells
  
  // === ANT COUNTS ===
  INITIAL_WORKERS: 20,
  INITIAL_SOLDIERS: 5,
  MAX_ANTS_PER_COLONY: 150,
  
  // === FOOD & RESOURCES ===
  FOOD_CLUSTERS: 40,            // Number of food patches on map (scaled for bigger world)
  FOOD_PER_CLUSTER: 120,        // Food units per patch
  FOOD_CARRY_CAPACITY: 1,      // How much one ant can carry
  FOOD_DEPOT_CAPACITY: 1000,   // Max food colony can store
  FOOD_RESPAWN_CHANCE: 0.0005, // Chance per tick of a depleted patch respawning
  
  // === ANT BEHAVIOR: MOVEMENT ===
  ANT_SPEED: 0.15,             // Grid cells per tick — slow for big world (ant-scale feeling)
  ANT_ROTATION_SPEED: 0.12,    // Radians per tick for turning
  ANT_WANDER_ANGLE_CHANGE: 0.25, // Radians per tick while wandering
  ANT_TURN_MAX: 0.4,           // Max pheromone steer adjustment per tick (radians)
  ANT_WANDER_PROBABILITY: 0.5,  // Probability of ignoring pheromone trail (natural variation)
  
  // === ANT BEHAVIOR: COMBAT ===
  SOLDIER_DAMAGE: 2,
  WORKER_DAMAGE: 1,
  WORKER_HEALTH: 8,
  SOLDIER_HEALTH: 15,
  QUEEN_HEALTH: 100,
  BITE_COOLDOWN: 10,           // Ticks between bites
  BITE_RANGE: 1.5,             // Grid cells
  
  // === ANT BEHAVIOR: FORAGING ===
  FOOD_SEARCH_RANGE: 10,       // How far ant can detect food
  PHEROMONE_STRENGTH_FOOD: 100,
  PHEROMONE_STRENGTH_HOME: 80,
  PHEROMONE_DEPOSIT_RATE: 3,   // Every N ticks while moving
  PHEROMONE_SENSOR_RANGE: 4,   // Cells ahead to sense pheromone
  PHEROMONE_SENSOR_SPREAD: 0.75,  // Angle spread (radians) of side sensors
  
  // === ANT BEHAVIOR: LIFE CYCLE ===
  EGG_INCUBATION_TICKS: 300,   // Ticks for egg → larva
  LARVA_GROWTH_TICKS: 400,     // Ticks for larva → pupa
  PUPA_GROWTH_TICKS: 300,      // Ticks for pupa → adult
  QUEEN_EGG_LAYING_INTERVAL: 90, // Ticks between egg-laying (slower)
  QUEEN_MIN_FOOD_TO_LAY: 80,   // Colony food threshold to lay eggs
  ANT_LIFESPAN_TICKS: 12000,   // Natural death age (~6.7 min at 30 ticks/sec)
  
  // === PHEROMONE PHYSICS ===
  // Realistic logarithmic-style decay: trails persist for minutes, not seconds.
  // At 0.999 per tick (30 ticks/sec): half-life ≈ 693 ticks ≈ 23 seconds.
  // A deposit of 80 stays detectable (>1) for ~7000 ticks ≈ 3.9 minutes.
  PHEROMONE_DECAY_RATE: 0.999, // Multiplier per tick — very slow fade (logarithmic feel)
  PHEROMONE_DIFFUSION: false,  // Spatial diffusion (expensive, disabled by default)
  PHEROMONE_CHANNELS: 4,       // 0=player food, 1=enemy food, 2=player alarm, 3=enemy alarm

  // === ALARM PHEROMONE ===
  ALARM_PHEROMONE_STRENGTH: 200, // Deposited when fighting
  ALARM_DETECT_RANGE: 20,     // How far ants can sense alarm (grid cells)
  ALARM_DECAY_RATE: 0.995,    // Alarm decays faster than food trail
  ALARM_SENSOR_RANGE: 6,      // Probe distance for alarm 3-sensor
  ALARM_RESPONSE_WORKER: 0.4, // Probability a worker responds to alarm (vs. keeps foraging)
  ALARM_RESPONSE_SOLDIER: 0.9,// Probability a soldier responds to alarm
  
  // === BUILDINGS ===
  BUILDING_TYPES: {
    TUNNEL: { cost: 10, name: 'Tunnel', bonus: 'movement_speed' },
    CHAMBER: { cost: 15, name: 'Chamber', bonus: 'food_storage' },
    FOOD_STORE: { cost: 20, name: 'Food Store', bonus: 'food_cap_increase' },
    NURSERY: { cost: 25, name: 'Nursery', bonus: 'egg_hatch_speed' },
    BARRICADE: { cost: 12, name: 'Barricade', bonus: 'blocks_enemy' },
    BEACON: { cost: 18, name: 'Beacon', bonus: 'visibility_range' },
  },
  
  // === PLAYER HERO ANT ===
  PLAYER_BITE_DAMAGE: 4,       // Slightly higher than soldier
  PLAYER_PHEROMONE_RALLY_STRENGTH: 120, // Rally pheromone strength
  PLAYER_RALLY_COOLDOWN: 20,   // Ticks between rally deposits
  PLAYER_FOV: 75,              // FPS camera field of view
  
  // === UI & HUD ===
  MINIMAP_WIDTH: 200,
  MINIMAP_HEIGHT: 150,
  MINIMAP_UPDATE_RATE: 5,      // Ticks between minimap updates
  
  // === RENDERING ===
  SHADOW_MAP_SIZE: 4096,
  BLOOM_STRENGTH: 0.5,
  BLOOM_THRESHOLD: 0.8,
  BLOOM_RADIUS: 0.4,
  
  // === VISION & FOG ===
  FOG_NEAR: 1,
  FOG_FAR: 500,
  FOG_COLOR: 0x87ceeb,         // Sky blue
  FOG_GROUND_COLOR: 0x4a7c59,  // Green
};

export default CONFIG;
