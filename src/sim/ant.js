import CONFIG from './config.js';

/**
 * Ant entity with state machine, movement, and combat logic.
 * AI modelled after petrofang/ant_simulator:
 *   WANDERING / FOLLOWING — forage for food (combined in _forage)
 *   CARRYING             — return home depositing pheromone trail, U-turn on deposit
 *   FIGHTING             — attack nearby enemy
 *   GUARDING             — soldier patrols near nest
 */
export class Ant {
  constructor(id, type, colonyId, nestX, nestY) {
    this.id = id;
    this.type = type;              // 'WORKER', 'SOLDIER', or 'QUEEN'
    this.colonyId = colonyId;      // 0 = player, 1 = enemy
    
    // Position (float grid coordinates)
    this.x = nestX;
    this.y = nestY;
    this.nestX = nestX;
    this.nestY = nestY;
    this.angle = Math.random() * Math.PI * 2;
    
    // Life & health
    this.age = 0;
    this.health = type === 'QUEEN' ? CONFIG.QUEEN_HEALTH
      : type === 'SOLDIER' ? CONFIG.SOLDIER_HEALTH
      : CONFIG.WORKER_HEALTH;
    this.maxHealth = this.health;
    this.isDead = false;
    
    // State machine
    this.state = 'WANDERING';     // WANDERING, FOLLOWING, CARRYING, FIGHTING, GUARDING
    this.stateTimer = 0;
    
    // Foraging
    this.carryingFood = 0;
    
    // Combat
    this.biteCooldown = 0;
    this.hitFlash = 0;
    
    // Player control flag — when true, AI state machine is skipped
    this.isPlayerControlled = false;
    
    // Pheromone channel = own colony
    this.pheromoneChannel = colonyId;
    
    // Stats
    this.foodDeposited = 0;
    this.entsKilled = 0;
  }

  /**
   * Main update tick for this ant.
   */
  update(world, colony, otherColony) {
    if (this.isDead) return;

    if (this.health <= 0) {
      this.isDead = true;
      return;
    }

    this.age++;
    if (this.biteCooldown > 0) this.biteCooldown--;
    if (this.hitFlash > 0) this.hitFlash--;

    // Skip AI for player-controlled ant
    if (this.isPlayerControlled) return;

    // Queen is stationary
    if (this.type === 'QUEEN') return;

    // --- Always check for nearby enemies first (highest priority) ---
    const enemy = this._findNearbyEnemy(otherColony);
    if (enemy) {
      this._attackEnemy(enemy);
      return;
    }

    // If we were fighting but lost target, return to appropriate state
    if (this.state === 'FIGHTING') {
      this.state = (this.carryingFood > 0) ? 'CARRYING' : 'WANDERING';
    }

    // --- State machine ---
    switch (this.state) {
      case 'WANDERING':
      case 'FOLLOWING':
        this._forage(world);
        break;
      case 'CARRYING':
        this._returnHome(world, colony);
        break;
      case 'GUARDING':
        this._guard();
        break;
    }

    this._move();
  }

  // ─── FORAGING (WANDERING + FOLLOWING) ───────────────────────────────

  _forage(world) {
    // Check if standing on food — pick it up
    const foodHere = this._checkFoodAtFeet(world);
    if (foodHere) {
      const taken = Math.min(CONFIG.FOOD_CARRY_CAPACITY, foodHere.amount);
      if (taken > 0) {
        foodHere.amount -= taken;
        this.carryingFood = taken;
        this.state = 'CARRYING';
        // U-turn to head home with slight randomness
        this.angle += Math.PI + (Math.random() - 0.5) * 0.4;
        return;
      }
    }

    // --- Pheromone-guided steering (3-sensor antenna model) ---
    const steer = this._pheromoneSteer(world);
    
    if (steer !== null && Math.random() > CONFIG.ANT_WANDER_PROBABILITY) {
      // Follow the pheromone trail
      this.angle += steer * CONFIG.ANT_TURN_MAX;
      this.state = 'FOLLOWING';
    } else {
      // Random walk — gentle wandering
      this.angle += (Math.random() - 0.5) * CONFIG.ANT_WANDER_ANGLE_CHANGE * 2.2;
      this.state = 'WANDERING';
    }
  }

  // ─── RETURNING HOME WITH FOOD ───────────────────────────────────────

  _returnHome(world, colony) {
    // Deposit pheromone trail while carrying food home
    // This trail leads FROM food TO nest — other ants follow it to find food
    world.depositPheromone(this.x, this.y, this.pheromoneChannel, CONFIG.PHEROMONE_STRENGTH_HOME);

    // Check if we reached the nest
    const distToNest = Math.hypot(this.x - this.nestX, this.y - this.nestY);
    if (distToNest < CONFIG.NEST_RADIUS) {
      // Deposit food
      colony.foodAmount += this.carryingFood;
      this.carryingFood = 0;
      this.foodDeposited++;
      
      // U-turn away from nest to go forage again
      this.state = 'WANDERING';
      this.angle += Math.PI + (Math.random() - 0.5) * 0.6;
      return;
    }

    // Steer toward home nest with slight randomness
    const dx = this.nestX - this.x;
    const dy = this.nestY - this.y;
    const homeAngle = Math.atan2(dy, dx);
    this.angle = homeAngle + (Math.random() - 0.5) * 0.35;
  }

  // ─── COMBAT ─────────────────────────────────────────────────────────

  _attackEnemy(enemy) {
    this.state = 'FIGHTING';
    
    // Face enemy
    const dx = enemy.x - this.x;
    const dy = enemy.y - this.y;
    this.angle = Math.atan2(dy, dx);
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > CONFIG.BITE_RANGE) {
      // Move toward enemy (we'll move in the main _move call)
      return;
    }
    
    if (this.biteCooldown <= 0) {
      const damage = this.type === 'SOLDIER' ? CONFIG.SOLDIER_DAMAGE : CONFIG.WORKER_DAMAGE;
      enemy.health -= damage;
      enemy.hitFlash = 10;
      this.biteCooldown = CONFIG.BITE_COOLDOWN;
      
      if (enemy.health <= 0) {
        enemy.isDead = true;
        this.entsKilled++;
      }
    }
  }

  // ─── GUARDING (soldiers near nest) ──────────────────────────────────

  _guard() {
    // Patrol randomly around nest area
    this.angle += (Math.random() - 0.5) * 0.7;
    
    // Drift back toward nest if too far
    const distToNest = Math.hypot(this.x - this.nestX, this.y - this.nestY);
    if (distToNest > CONFIG.NEST_RADIUS * 3) {
      const homeAngle = Math.atan2(this.nestY - this.y, this.nestX - this.x);
      this.angle = this._lerpAngle(this.angle, homeAngle, 0.3);
    }
  }

  // ─── MOVEMENT ───────────────────────────────────────────────────────

  _move() {
    const spd = this.isPlayerControlled ? CONFIG.ANT_SPEED * 1.5 : CONFIG.ANT_SPEED;
    let nx = this.x + Math.cos(this.angle) * spd;
    let ny = this.y + Math.sin(this.angle) * spd;

    // Bounce off borders (like Ant Simulator)
    if (nx < 1 || nx >= CONFIG.WORLD_WIDTH - 1) {
      this.angle = Math.PI - this.angle;
      nx = Math.max(1, Math.min(CONFIG.WORLD_WIDTH - 2, nx));
    }
    if (ny < 1 || ny >= CONFIG.WORLD_HEIGHT - 1) {
      this.angle = -this.angle;
      ny = Math.max(1, Math.min(CONFIG.WORLD_HEIGHT - 2, ny));
    }

    this.x = nx;
    this.y = ny;
  }

  // ─── SENSORS ────────────────────────────────────────────────────────

  /**
   * 3-sensor pheromone steering (left / forward / right probes).
   * Returns a steer value in [-1, 0, +1] or null if no signal.
   */
  _pheromoneSteer(world) {
    const dist = CONFIG.PHEROMONE_SENSOR_RANGE;
    const ang = CONFIG.PHEROMONE_SENSOR_SPREAD;

    const L = world.readPheromone(
      this.x + Math.cos(this.angle - ang) * dist,
      this.y + Math.sin(this.angle - ang) * dist,
      this.pheromoneChannel
    );
    const F = world.readPheromone(
      this.x + Math.cos(this.angle) * dist,
      this.y + Math.sin(this.angle) * dist,
      this.pheromoneChannel
    );
    const R = world.readPheromone(
      this.x + Math.cos(this.angle + ang) * dist,
      this.y + Math.sin(this.angle + ang) * dist,
      this.pheromoneChannel
    );

    if (L === 0 && F === 0 && R === 0) return null;
    if (L > F && L > R) return -1;
    if (R > F && R > L) return  1;
    return 0;
  }

  /**
   * Check if there's food directly at the ant's feet (within ~1 cell).
   */
  _checkFoodAtFeet(world) {
    let closest = null;
    let closestDist = 1.5; // must be standing right on top of food
    
    for (const food of world.foodPatches) {
      if (food.amount <= 0) continue;
      const dist = Math.hypot(this.x - food.x, this.y - food.y);
      if (dist < closestDist) {
        closestDist = dist;
        closest = food;
      }
    }
    return closest;
  }

  _findNearbyEnemy(otherColony) {
    const detectRange = CONFIG.FOOD_SEARCH_RANGE; // reuse as enemy detect range
    let closest = null;
    let closestDist = detectRange;

    for (const ant of otherColony.ants) {
      if (ant.isDead) continue;
      const dist = Math.hypot(this.x - ant.x, this.y - ant.y);
      if (dist < closestDist) {
        closestDist = dist;
        closest = ant;
      }
    }
    return closest;
  }

  /**
   * Interpolate between two angles along the shorter arc.
   */
  _lerpAngle(from, to, t) {
    let diff = to - from;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return from + diff * t;
  }
}

export default Ant;
